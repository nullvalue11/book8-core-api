// src/routes/internalProvision.js
import express from "express";
import { ensureTenant } from "../../services/tenantEnsure.js";
import { Business } from "../../models/Business.js";
import { businessLookupFilter } from "../../services/provisioningHelpers.js";
import {
  getPlanForPriceId,
  resolveCurrencyFromStripeSubscription,
  resolvePlanFromStripeSubscription
} from "../config/plans.js";
import { getStripe } from "../../services/stripeNoShow.js";

const router = express.Router();

/**
 * POST /internal/provision-from-stripe
 *
 * Called by book8-ai after a successful Stripe checkout.session.completed.
 * Provisions a new tenant with default bookable state.
 *
 * Body: {
 *   businessId: "diamond-gym",          // slug derived from business name
 *   name: "Diamond Gym",                // business display name
 *   email: "owner@diamondgym.com",      // owner email from Stripe
 *   category: "fitness",                // optional — will auto-classify if missing
 *   timezone: "America/Toronto",        // optional — defaults to America/Toronto
 *   stripeCustomerId: "cus_xxx",        // Stripe customer ID for linking
 *   stripeSubscriptionId: "sub_xxx",    // Stripe subscription ID
 *   plan: "enterprise"                  // plan name from checkout
 * }
 *
 * Returns: {
 *   ok: true,
 *   businessId: "diamond-gym",
 *   existed: false,
 *   created: true,
 *   defaultsEnsured: true,
 *   message: "Tenant provisioned and bookable"
 * }
 */
router.post("/", async (req, res) => {
  try {
    const {
      businessId,
      name,
      email,
      category,
      timezone,
      description,
      phoneNumber,
      stripeCustomerId,
      stripeSubscriptionId,
      stripePriceId,
      plan,
      calendarProvider,
      calendar
    } = req.body;

    // Validate required fields
    if (!businessId || !name) {
      return res.status(400).json({
        ok: false,
        error: "businessId and name are required"
      });
    }

    console.log("[provision-from-stripe] Provisioning tenant:", {
      businessId,
      name,
      hasEmail: !!email,
      plan,
      stripeCustomerId: stripeCustomerId ? "present" : "missing",
      stripeSubscriptionId: stripeSubscriptionId ? "present" : "missing"
    });

    // Use ensureTenant — it's idempotent, so duplicate webhook calls are safe
    const result = await ensureTenant({
      businessId,
      name,
      description,
      category,
      timezone: timezone || "America/Toronto",
      email,
      phoneNumber,
      country: req.body.country
    });

    if (!result.ok) {
      console.error("[provision-from-stripe] ensureTenant failed:", result.error);
      return res.status(400).json({
        ok: false,
        error: result.error
      });
    }

    // If we have Stripe IDs, store them on the business for billing linkage
    // This is a best-effort update — don't fail provisioning if it errors
    if (stripeCustomerId || stripeSubscriptionId || plan || stripePriceId) {
      try {
        let resolvedPlan =
          typeof plan === "string" ? plan.trim().toLowerCase() : "";
        if (stripePriceId) {
          const fromPrice = getPlanForPriceId(stripePriceId);
          if (fromPrice) resolvedPlan = fromPrice;
        }
        let resolvedCurrency =
          typeof req.body.currency === "string" ? req.body.currency.trim().toLowerCase() : "";
        if (stripeSubscriptionId && getStripe()) {
          try {
            const sub = await getStripe().subscriptions.retrieve(stripeSubscriptionId);
            const fromSub = resolvePlanFromStripeSubscription(sub);
            if (fromSub) resolvedPlan = fromSub;
            const fromStripeCurrency = resolveCurrencyFromStripeSubscription(sub);
            if (fromStripeCurrency) resolvedCurrency = fromStripeCurrency;
          } catch (subErr) {
            console.warn(
              "[provision-from-stripe] Could not resolve plan from Stripe subscription:",
              subErr?.message || subErr
            );
          }
        }

        const update = {};
        if (stripeCustomerId) update.stripeCustomerId = stripeCustomerId;
        if (stripeSubscriptionId) update.stripeSubscriptionId = stripeSubscriptionId;
        if (resolvedPlan && resolvedPlan !== "none") {
          update.plan = resolvedPlan;
          update["subscription.plan"] = resolvedPlan;
        }
        if (resolvedCurrency) {
          update.preferredCurrency = resolvedCurrency;
          update["subscription.currency"] = resolvedCurrency;
        }
        if (stripeSubscriptionId) {
          update["trial.status"] = "subscribed";
          update["subscription.status"] = "active";
          update["subscription.updatedAt"] = new Date();
          console.log(`[trial-lifecycle] business=${businessId} provisioned status=subscribed`);
        }
        const providerFromBody = calendarProvider || calendar?.provider;
        if (providerFromBody === "google" || providerFromBody === "microsoft") {
          update.calendarProvider = providerFromBody;
        }

        await Business.findOneAndUpdate(
          businessLookupFilter(businessId),
          { $set: update }
        );
        console.log("[provision-from-stripe] Stripe billing fields saved for:", businessId);
      } catch (stripeErr) {
        // Log but don't fail — the tenant is provisioned, billing linkage can be fixed later
        console.error("[provision-from-stripe] Failed to save Stripe fields:", stripeErr);
      }
    }

    // BOO-PHASE4B-2A Model B: trial uses shared demo line; dedicated number provisions on
    // customer.subscription.updated when previous_attributes.status=trialing → active.
    console.log(
      `[provision-from-stripe] Skipping Twilio assign for ${businessId} — dedicated number provisions on paid conversion`
    );

    console.log("[provision-from-stripe] Success:", {
      businessId: result.businessId,
      existed: result.existed,
      created: result.created,
      defaultsEnsured: result.defaultsEnsured
    });

    return res.json({
      ok: true,
      businessId: result.businessId,
      existed: result.existed,
      created: result.created,
      defaultsEnsured: result.defaultsEnsured,
      message: result.created
        ? "Tenant provisioned and bookable"
        : "Tenant already exists"
    });
  } catch (err) {
    console.error("[provision-from-stripe] Error:", err);
    return res.status(500).json({
      ok: false,
      error: "Internal server error during provisioning"
    });
  }
});

export default router;

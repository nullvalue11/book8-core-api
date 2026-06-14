/**
 * BOO-97A — Internal endpoint for book8-ai (or jobs) to mirror Stripe subscription.state into core-api.
 * POST /internal/subscription-sync
 *
 * BOO-PHASE4B-2A: pass Stripe webhook context for trial→paid number provisioning:
 *   previousSubscriptionStatus — event.data.previous_attributes.status (required for provision trigger)
 *   stripeEventType — event.type (customer.subscription.updated)
 */
import express from "express";
import { Business } from "../../models/Business.js";
import { businessLookupFilter } from "../../services/provisioningHelpers.js";
import { getStripe } from "../../services/stripeNoShow.js";
import {
  PAID_LIKE,
  verifyPaidSubscriptionSync
} from "../../services/stripeSubscriptionVerify.js";
import {
  getPlanForPriceId,
  resolveCurrencyFromStripeSubscription,
  resolvePlanFromStripeSubscription
} from "../config/plans.js";
import {
  provisionBusinessNumber,
  shouldProvisionNumberOnPaidConversion
} from "../../services/provisionBusinessNumber.js";

const router = express.Router();

const ENDED = new Set(["canceled", "unpaid", "incomplete_expired"]);
const VALID_PLANS = new Set(["starter", "growth", "enterprise"]);

function normalizePlanInput(plan) {
  if (typeof plan !== "string") return null;
  const p = plan.trim().toLowerCase();
  return VALID_PLANS.has(p) ? p : null;
}

router.post("/", async (req, res) => {
  try {
    const {
      businessId,
      stripeSubscriptionId,
      subscriptionStatus,
      plan,
      stripePriceId,
      currency,
      previousSubscriptionStatus: previousStatusBody,
      previousAttributes,
      stripeEventType,
      source
    } = req.body || {};
    if (!businessId || typeof businessId !== "string") {
      return res.status(400).json({ ok: false, error: "businessId is required" });
    }
    if (!subscriptionStatus || typeof subscriptionStatus !== "string") {
      return res.status(400).json({ ok: false, error: "subscriptionStatus is required" });
    }

    const st = subscriptionStatus.trim().toLowerCase();
    const filter = businessLookupFilter(businessId.trim());
    const doc = await Business.findOne(filter).lean();
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    let resolvedPlan = normalizePlanInput(plan);
    if (!resolvedPlan && stripePriceId) {
      resolvedPlan = getPlanForPriceId(stripePriceId);
    }
    let resolvedCurrency =
      typeof currency === "string" && currency.trim() ? currency.trim().toLowerCase() : null;

    if (PAID_LIKE.has(st)) {
      const vr = await verifyPaidSubscriptionSync({
        stripe: getStripe(),
        claimedStatusLower: st,
        stripeSubscriptionId,
        storedStripeCustomerId: doc.stripeCustomerId
      });
      if (!vr.ok) {
        return res.status(vr.status).json({
          ok: false,
          error: vr.code,
          message: vr.message
        });
      }
      const fromStripe =
        vr.resolvedPlan ||
        resolvePlanFromStripeSubscription(vr.stripeSubscription);
      if (fromStripe) {
        resolvedPlan = fromStripe;
      }
      const fromStripeCurrency = resolveCurrencyFromStripeSubscription(vr.stripeSubscription);
      if (fromStripeCurrency) {
        resolvedCurrency = fromStripeCurrency;
      }
    }

    const update = {
      "subscription.status": st,
      "subscription.updatedAt": new Date()
    };
    if (stripeSubscriptionId && typeof stripeSubscriptionId === "string") {
      update.stripeSubscriptionId = stripeSubscriptionId.trim();
    }
    if (resolvedPlan) {
      update.plan = resolvedPlan;
    }
    if (PAID_LIKE.has(st) && resolvedPlan) {
      update["subscription.plan"] = resolvedPlan;
    }
    if (resolvedCurrency) {
      update.preferredCurrency = resolvedCurrency;
      update["subscription.currency"] = resolvedCurrency;
    }

    const unset = {};
    if (PAID_LIKE.has(st)) {
      update["trial.status"] = "subscribed";
      console.log(
        `[trial-lifecycle] business=${businessId} status→subscribed stripeSub=${stripeSubscriptionId || doc.stripeSubscriptionId || "n/a"}`
      );
    } else if (ENDED.has(st)) {
      unset["trial.status"] = "";
      console.log(`[trial-lifecycle] business=${businessId} subscription ended status=${st} (trial flag cleared for date-based enforcement)`);
    } else {
      console.log(`[trial-lifecycle] business=${businessId} subscriptionStatus=${st}`);
    }

    await Business.findOneAndUpdate(
      filter,
      Object.keys(unset).length ? { $set: update, $unset: unset } : { $set: update },
      { new: true }
    );

    const bid = doc.id || doc.businessId;
    const previousSubscriptionStatus = normalizePreviousSubscriptionStatus(
      previousStatusBody,
      previousAttributes
    );
    const eventType =
      typeof stripeEventType === "string" && stripeEventType.trim()
        ? stripeEventType.trim()
        : typeof source === "string" && source.trim()
          ? source.trim()
          : null;

    let numberProvisioning = null;
    if (
      shouldProvisionNumberOnPaidConversion({
        previousSubscriptionStatus,
        newSubscriptionStatus: st,
        business: doc,
        stripeEventType: eventType
      })
    ) {
      try {
        numberProvisioning = await provisionBusinessNumber(bid);
        if (numberProvisioning.skipped) {
          console.log(
            `[subscription-sync] number provisioning skipped for ${bid}: ${numberProvisioning.detail}`
          );
        } else if (numberProvisioning.ok) {
          console.log(
            `[subscription-sync] dedicated number provisioned for ${bid}: ${numberProvisioning.detail || "ok"}`
          );
        } else {
          console.warn(
            `[subscription-sync] number provisioning failed for ${bid}: ${numberProvisioning.detail}`
          );
        }
      } catch (provErr) {
        console.error(`[subscription-sync] number provisioning error for ${bid}:`, provErr?.message || provErr);
        numberProvisioning = {
          ok: false,
          detail: provErr?.message || "provisioning_error",
          retryable: true
        };
      }
    }

    return res.json({
      ok: true,
      businessId: bid,
      ...(numberProvisioning ? { numberProvisioning } : {})
    });
  } catch (err) {
    console.error("[internal/subscription-sync]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

function normalizePreviousSubscriptionStatus(previousStatusBody, previousAttributes) {
  if (typeof previousStatusBody === "string" && previousStatusBody.trim()) {
    return previousStatusBody.trim().toLowerCase();
  }
  if (
    previousAttributes &&
    typeof previousAttributes.status === "string" &&
    previousAttributes.status.trim()
  ) {
    return previousAttributes.status.trim().toLowerCase();
  }
  return null;
}

export default router;

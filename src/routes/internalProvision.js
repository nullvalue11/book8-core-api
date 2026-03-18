// src/routes/internalProvision.js
import express from "express";
import twilio from "twilio";
import { ensureTenant } from "../../services/tenantEnsure.js";
import { Business } from "../../models/Business.js";
import { TwilioNumber } from "../../models/TwilioNumber.js";

const router = express.Router();
const SMS_WEBHOOK_URL = process.env.BOOK8_CORE_API_URL
  ? `${process.env.BOOK8_CORE_API_URL.replace(/\/$/, "")}/api/twilio/inbound-sms`
  : "https://book8-core-api.onrender.com/api/twilio/inbound-sms";

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
      plan
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
      email,
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
      phoneNumber
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
    if (stripeCustomerId || stripeSubscriptionId || plan) {
      try {
        const update = {};
        if (stripeCustomerId) update.stripeCustomerId = stripeCustomerId;
        if (stripeSubscriptionId) update.stripeSubscriptionId = stripeSubscriptionId;
        if (plan) update.plan = plan;

        await Business.findOneAndUpdate(
          { id: businessId },
          { $set: update }
        );
        console.log("[provision-from-stripe] Stripe billing fields saved for:", businessId);
      } catch (stripeErr) {
        // Log but don't fail — the tenant is provisioned, billing linkage can be fixed later
        console.error("[provision-from-stripe] Failed to save Stripe fields:", stripeErr);
      }
    }

    // Auto-assign a Twilio number from the pool (best-effort; never crash provisioning)
    try {
      const business = await Business.findOne({ id: businessId }).lean();
      if (business?.assignedTwilioNumber) {
        // Already has a number — skip
      } else {
        const number = await TwilioNumber.findOneAndUpdate(
          { status: "available" },
          {
            status: "assigned",
            assignedToBusinessId: businessId,
            assignedAt: new Date(),
            updatedAt: new Date()
          },
          { new: true, sort: { createdAt: 1 } }
        );

        if (!number) {
          console.error("[provisioning] No available Twilio numbers in pool!");
          await Business.findOneAndUpdate(
            { id: businessId },
            { $set: { numberSetupMethod: "pending" } }
          );
        } else {
          await Business.findOneAndUpdate(
            { id: businessId },
            {
              $set: {
                assignedTwilioNumber: number.phoneNumber,
                numberSetupMethod: "direct"
              }
            }
          );

          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const authToken = process.env.TWILIO_AUTH_TOKEN;
          if (accountSid && authToken) {
            const twilioClient = twilio(accountSid, authToken);
            await twilioClient.incomingPhoneNumbers(number.twilioSid).update({
              smsUrl: SMS_WEBHOOK_URL,
              smsMethod: "POST"
            });
          }
          console.log("[provisioning] Assigned", number.phoneNumber, "to", businessId);
        }
      }
    } catch (numberErr) {
      console.error("[provisioning] Number assignment failed:", numberErr);
      await Business.findOneAndUpdate(
        { id: businessId },
        { $set: { numberSetupMethod: "pending" } }
      ).catch(() => {});
    }

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

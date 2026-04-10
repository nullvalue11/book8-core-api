/**
 * BOO-97A — Internal endpoint for book8-ai (or jobs) to mirror Stripe subscription.state into core-api.
 * POST /internal/subscription-sync
 */
import express from "express";
import { Business } from "../../models/Business.js";
import { businessLookupFilter } from "../../services/provisioningHelpers.js";

const router = express.Router();

const PAID_LIKE = new Set(["active", "trialing", "past_due"]);
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired"]);

router.post("/", async (req, res) => {
  try {
    const { businessId, stripeSubscriptionId, subscriptionStatus } = req.body || {};
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

    const update = {
      "subscription.status": st,
      "subscription.updatedAt": new Date()
    };
    if (stripeSubscriptionId && typeof stripeSubscriptionId === "string") {
      update.stripeSubscriptionId = stripeSubscriptionId.trim();
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

    return res.json({ ok: true, businessId: doc.id || doc.businessId });
  } catch (err) {
    console.error("[internal/subscription-sync]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

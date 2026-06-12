// src/routes/internalBilling.js — BOO-MULTI-CURRENCY-FIX-1A
import express from "express";
import { Business } from "../../models/Business.js";
import { businessLookupFilter } from "../../services/provisioningHelpers.js";
import { resolveCheckoutPrice, resolveSubscriptionPriceForBusiness } from "../config/plans.js";

const router = express.Router();

const VALID_PLANS = new Set(["starter", "growth", "enterprise"]);

/**
 * POST /internal/billing/checkout-price
 * Body: { plan, currency?, businessId? }
 * Response: { ok, plan, currency, priceId }
 *
 * Contract for book8-ai checkout (1B): pass tier + currency only; core-api selects Price ID.
 * currency defaults to cad when absent or invalid.
 */
router.post("/checkout-price", async (req, res) => {
  try {
    const { plan, currency, businessId } = req.body ?? {};
    const planKey = typeof plan === "string" ? plan.trim().toLowerCase() : "";
    if (!VALID_PLANS.has(planKey)) {
      return res.status(400).json({ ok: false, error: "plan must be starter, growth, or enterprise" });
    }

    let resolved;
    if (businessId && typeof businessId === "string" && currency == null) {
      const doc = await Business.findOne(businessLookupFilter(businessId.trim())).lean();
      if (!doc) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      resolved = resolveSubscriptionPriceForBusiness(doc, planKey);
      return res.json({ ok: true, plan: planKey, ...resolved });
    }

    try {
      resolved = resolveCheckoutPrice(planKey, currency);
    } catch (err) {
      const msg = err?.message || "Invalid checkout price request";
      if (/unknown plan/i.test(msg)) {
        return res.status(400).json({ ok: false, error: msg });
      }
      if (/no stripe price id/i.test(msg)) {
        return res.status(503).json({ ok: false, error: msg });
      }
      throw err;
    }

    return res.json({ ok: true, ...resolved });
  } catch (err) {
    console.error("[internal/billing/checkout-price]", err);
    return res.status(500).json({ ok: false, error: "Checkout price resolution failed" });
  }
});

export default router;

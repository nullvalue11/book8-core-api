// BOO-MULTI-CURRENCY-1A — public plan pricing for onboarding UI
import express from "express";
import { DEFAULT_CURRENCY, getCurrencyForCountry } from "../config/currencyMap.js";
import { getPlansPricingByCurrency } from "../config/plans.js";
import { strictLimiter } from "../middleware/strictLimiter.js";

const router = express.Router();

router.get("/pricing", strictLimiter, (req, res) => {
  try {
    const raw = req.query.country;
    const trimmed = raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;
    const currency = trimmed ? getCurrencyForCountry(trimmed) : DEFAULT_CURRENCY;
    res.json(getPlansPricingByCurrency(currency));
  } catch (err) {
    console.error("[GET /api/plans/pricing]", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

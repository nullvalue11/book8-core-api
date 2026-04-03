// BOO-45A: PATCH /api/businesses/:id/no-show-settings
import express from "express";
import { Business } from "../../models/Business.js";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import { requireFeature } from "../middleware/planCheck.js";
import { clampWindowHours } from "../../services/noShowProtection.js";

const router = express.Router();

router.patch(
  "/:id/no-show-settings",
  strictLimiter,
  requireInternalAuth,
  requireFeature("noShowProtection"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { enabled, feeType, feeAmount, cancellationWindowHours, autoCharge, currency } = req.body || {};

      const biz = await Business.findOne({ $or: [{ id }, { businessId: id }] });
      if (!biz) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      const next = biz.noShowProtection?.toObject?.() || biz.noShowProtection || {};
      if (enabled !== undefined) next.enabled = !!enabled;
      if (feeType === "fixed" || feeType === "percentage") next.feeType = feeType;
      if (feeAmount !== undefined) next.feeAmount = Number(feeAmount);
      if (cancellationWindowHours !== undefined) {
        next.cancellationWindowHours = clampWindowHours(cancellationWindowHours);
      }
      if (autoCharge !== undefined) next.autoCharge = !!autoCharge;
      if (currency !== undefined && typeof currency === "string" && currency.trim()) {
        next.currency = currency.trim().toLowerCase().slice(0, 8);
      }

      if (next.enabled) {
        const amt = Number(next.feeAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
          return res.status(400).json({
            ok: false,
            error: "feeAmount must be greater than 0 when no-show protection is enabled"
          });
        }
        const wh = clampWindowHours(next.cancellationWindowHours);
        if (wh < 1 || wh > 72) {
          return res.status(400).json({
            ok: false,
            error: "cancellationWindowHours must be between 1 and 72"
          });
        }
      }

      biz.noShowProtection = next;
      await biz.save();

      return res.json({
        ok: true,
        business: {
          id: biz.id ?? biz.businessId,
          noShowProtection: biz.noShowProtection
        }
      });
    } catch (err) {
      console.error("[no-show-settings]", err);
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  }
);

export default router;

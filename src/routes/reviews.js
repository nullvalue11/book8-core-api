// BOO-58A: public review submit + list; internal status patch
import express from "express";
import { Business } from "../../models/Business.js";
import { publicBookingLimiter } from "../middleware/publicBookingLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import {
  submitPublicReview,
  listPublicReviewsForBusiness,
  setReviewStatus
} from "../../services/reviewService.js";

const router = express.Router();

router.post("/", publicBookingLimiter, async (req, res) => {
  try {
    const result = await submitPublicReview(req.body || {});
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, error: result.error });
    }
    return res.status(201).json({ ok: true, review: result.review });
  } catch (err) {
    console.error("[POST /api/reviews]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.patch("/:id/status", requireInternalAuth, async (req, res) => {
  try {
    const result = await setReviewStatus(req.params.id, req.body?.status);
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, review: result.review });
  } catch (err) {
    console.error("[PATCH /api/reviews/:id/status]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** Must be registered before GET /api/businesses/:id so `reviews` is not captured as :id */
export async function handleGetBusinessReviews(req, res) {
  try {
    const param = req.params.id;
    const business = await Business.findOne({
      $or: [{ id: param }, { businessId: param }]
    }).lean();
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }
    const businessId = business.id ?? business.businessId;
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || "10"), 10);
    const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 10));
    const data = await listPublicReviewsForBusiness(businessId, page, limit);
    return res.json({ ok: true, ...data });
  } catch (err) {
    console.error("[GET /api/businesses/:id/reviews]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

export default router;

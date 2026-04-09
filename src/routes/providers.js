// src/routes/providers.js — BOO-44A multi-provider CRUD
import express from "express";
import { randomBytes } from "crypto";
import { Business } from "../../models/Business.js";
import { Provider } from "../../models/Provider.js";
import { publicBookingLimiter } from "../middleware/publicBookingLimiter.js";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import { getPlanFeatures } from "../config/plans.js";

const router = express.Router();

function generateProviderId() {
  const suffix = randomBytes(9).toString("base64url").replace(/[-_]/g, "X").slice(0, 12);
  return `prov_${suffix}`;
}

function maxProvidersForPlan(plan) {
  const v = getPlanFeatures(plan || "starter").maxProviders;
  if (v === -1) return Number.MAX_SAFE_INTEGER;
  return typeof v === "number" ? v : 0;
}

export function toPublicProvider(p) {
  if (!p) return null;
  return {
    id: p.id,
    businessId: p.businessId,
    name: p.name,
    title: p.title || null,
    avatar: p.avatar?.url ? { url: p.avatar.url } : null,
    services: p.services || [],
    schedule: p.schedule || null,
    sortOrder: p.sortOrder ?? 0,
    isActive: p.isActive !== false
  };
}

/** GET /api/businesses/:businessId/providers — public */
router.get("/:businessId/providers", publicBookingLimiter, async (req, res) => {
  try {
    const { businessId } = req.params;
    const biz = await Business.findOne({ $or: [{ id: businessId }, { businessId }] }).lean();
    if (!biz) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }
    const bid = biz.id ?? biz.businessId;
    const providers = await Provider.find({ businessId: bid, isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    return res.json({
      ok: true,
      businessId: bid,
      providers: providers.map(toPublicProvider)
    });
  } catch (err) {
    console.error("Error in GET providers:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** GET /api/businesses/:businessId/providers/:providerId — public */
router.get("/:businessId/providers/:providerId", publicBookingLimiter, async (req, res) => {
  try {
    const { businessId, providerId } = req.params;
    const biz = await Business.findOne({ $or: [{ id: businessId }, { businessId }] }).lean();
    if (!biz) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }
    const bid = biz.id ?? biz.businessId;
    const p = await Provider.findOne({ businessId: bid, id: providerId }).lean();
    if (!p || !p.isActive) {
      return res.status(404).json({ ok: false, error: "Provider not found" });
    }
    return res.json({ ok: true, provider: toPublicProvider(p) });
  } catch (err) {
    console.error("Error in GET provider:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** POST /api/businesses/:businessId/providers */
router.post("/:businessId/providers", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { businessId } = req.params;
    const biz = await Business.findOne({ $or: [{ id: businessId }, { businessId }] });
    if (!biz) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }
    const bid = biz.id ?? biz.businessId;
    const plan = biz.plan || "starter";
    const maxP = maxProvidersForPlan(plan);
    const count = await Provider.countDocuments({ businessId: bid });
    if (count >= maxP) {
      return res.status(403).json({
        ok: false,
        error: `Plan "${plan}" allows at most ${maxP === Number.MAX_SAFE_INTEGER ? "unlimited" : maxP} providers`,
        currentPlan: plan,
        maxProviders: maxP === Number.MAX_SAFE_INTEGER ? -1 : maxP
      });
    }

    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ ok: false, error: "name is required" });
    }

    const id = generateProviderId();
    const doc = await Provider.create({
      id,
      businessId: bid,
      name,
      title: body.title != null ? String(body.title).trim().slice(0, 200) : undefined,
      email: body.email,
      phone: body.phone,
      services: Array.isArray(body.services) ? body.services.map((s) => String(s).trim()).filter(Boolean) : [],
      schedule: body.schedule && typeof body.schedule === "object" ? body.schedule : undefined,
      calendarId: body.calendarId,
      calendarProvider: body.calendarProvider || null,
      avatar: body.avatar,
      isActive: body.isActive !== false,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0
    });

    return res.status(201).json({ ok: true, provider: doc.toObject() });
  } catch (err) {
    console.error("Error in POST provider:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** PATCH /api/businesses/:businessId/providers/:providerId */
router.patch("/:businessId/providers/:providerId", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { businessId, providerId } = req.params;
    const biz = await Business.findOne({ $or: [{ id: businessId }, { businessId }] }).lean();
    if (!biz) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }
    const bid = biz.id ?? biz.businessId;
    const doc = await Provider.findOne({ businessId: bid, id: providerId });
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Provider not found" });
    }

    const body = req.body || {};
    const $set = {};
    if (typeof body.name === "string" && body.name.trim()) $set.name = body.name.trim();
    if (body.title !== undefined) $set.title = body.title != null ? String(body.title).trim().slice(0, 200) : "";
    if (body.email !== undefined) $set.email = body.email;
    if (body.phone !== undefined) $set.phone = body.phone;
    if (Array.isArray(body.services)) $set.services = body.services.map((s) => String(s).trim()).filter(Boolean);
    if (body.schedule && typeof body.schedule === "object") $set.schedule = body.schedule;
    if (body.calendarId !== undefined) $set.calendarId = body.calendarId;
    if (body.calendarProvider !== undefined) $set.calendarProvider = body.calendarProvider;
    if (body.avatar !== undefined) $set.avatar = body.avatar;
    if (typeof body.isActive === "boolean") $set.isActive = body.isActive;
    if (typeof body.sortOrder === "number") $set.sortOrder = body.sortOrder;

    Object.assign(doc, $set);
    await doc.save();
    return res.json({ ok: true, provider: doc.toObject() });
  } catch (err) {
    console.error("Error in PATCH provider:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** DELETE — soft deactivate */
router.delete("/:businessId/providers/:providerId", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { businessId, providerId } = req.params;
    const biz = await Business.findOne({ $or: [{ id: businessId }, { businessId }] }).lean();
    if (!biz) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }
    const bid = biz.id ?? biz.businessId;
    const doc = await Provider.findOneAndUpdate(
      { businessId: bid, id: providerId },
      { $set: { isActive: false } },
      { new: true }
    ).lean();
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Provider not found" });
    }
    return res.json({ ok: true, provider: doc });
  } catch (err) {
    console.error("Error in DELETE provider:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

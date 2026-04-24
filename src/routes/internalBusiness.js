// src/routes/internalBusiness.js
import express from "express";
import { Business } from "../../models/Business.js";
import { requireFeature } from "../middleware/planCheck.js";
import { buildCalendarSyncUpdate } from "../utils/calendarSyncPayload.js";

const router = express.Router();

const VALID_PLANS = new Set(["starter", "growth", "enterprise"]);

function planGatesForUpdateCalendar(req, res, next) {
  const { calendarProvider, multilingualEnabled } = req.body || {};
  const providerLc = calendarProvider ? String(calendarProvider).toLowerCase() : "";
  const connectingOutlook = providerLc === "microsoft" || providerLc === "outlook";
  if (connectingOutlook) {
    return requireFeature("outlookCalendar")(req, res, next);
  }
  if (typeof multilingualEnabled === "boolean" && multilingualEnabled === true) {
    return requireFeature("multilingual")(req, res, next);
  }
  next();
}

/**
 * POST /internal/business/sync-calendar-state
 * BOO-117: book8-ai pushes dashboard OAuth calendar state → book8-core Business doc.
 * Auth: parent /internal/business mount + requireInternalAuth.
 */
router.post("/sync-calendar-state", async (req, res) => {
  try {
    const body = req.body || {};
    const businessId = body.businessId != null ? String(body.businessId).trim() : "";
    if (!businessId) {
      return res.status(400).json({ ok: false, error: "businessId required" });
    }

    const $set = buildCalendarSyncUpdate(body);
    if (Object.keys($set).length === 0) {
      return res.status(400).json({ ok: false, error: "calendar or calendarProvider required" });
    }

    const filter = { $or: [{ id: businessId }, { businessId }] };
    const existing = await Business.findOne(filter).select("_id").lean();
    if (!existing) {
      console.warn("[sync-calendar-state] business not found (no-op):", businessId);
      return res.json({ ok: true, skipped: true });
    }

    await Business.findOneAndUpdate(filter, { $set });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[sync-calendar-state]", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /internal/business/update-calendar
router.post("/update-calendar", planGatesForUpdateCalendar, async (req, res) => {
  try {
    const {
      businessId,
      calendarProvider,
      calendarConnected,
      timezone,
      primaryLanguage,
      multilingualEnabled,
      supportedLanguages,
      plan: bodyPlan,
      phoneSetup,
      existingBusinessNumber
    } = req.body || {};

    if (!businessId) {
      return res.status(400).json({ ok: false, error: "businessId required" });
    }

    const existing = await Business.findOne({
      $or: [{ id: businessId }, { businessId }]
    }).lean();

    if (!existing) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const provider = calendarProvider || null;

    const update = {
      calendarProvider: provider,
      "calendar.connected": !!calendarConnected,
      "calendar.provider": provider,
      "calendar.updatedAt": new Date()
    };

    if (typeof timezone === "string" && timezone.trim()) {
      const tz = timezone.trim();
      update.timezone = tz;
      update["weeklySchedule.timezone"] = tz;
    }

    if (typeof primaryLanguage === "string" && primaryLanguage.trim()) {
      update.primaryLanguage = primaryLanguage.trim();
    }
    if (typeof multilingualEnabled === "boolean") {
      update.multilingualEnabled = multilingualEnabled;
    }
    if (Array.isArray(supportedLanguages)) {
      update.supportedLanguages = supportedLanguages.filter(
        (x) => typeof x === "string" && x.trim()
      );
    }

    if (typeof bodyPlan === "string") {
      const planNorm = bodyPlan.toLowerCase();
      if (VALID_PLANS.has(planNorm)) {
        update.plan = planNorm;
      }
    }

    if (phoneSetup === "new" || phoneSetup === "forward") {
      update.phoneSetup = phoneSetup;
    }
    if (existingBusinessNumber !== undefined) {
      if (existingBusinessNumber === null) {
        update.existingBusinessNumber = null;
      } else if (typeof existingBusinessNumber === "string") {
        update.existingBusinessNumber = existingBusinessNumber.trim();
      }
    }

    const result = await Business.findOneAndUpdate(
      { $or: [{ id: businessId }, { businessId: businessId }] },
      { $set: update },
      { new: true }
    );

    console.log("[update-calendar] Synced:", {
      businessId,
      calendarProvider,
      calendarConnected,
      timezone: update.timezone,
      plan: update.plan,
      phoneSetup: update.phoneSetup,
      hasExistingBusinessNumber: update.existingBusinessNumber != null && update.existingBusinessNumber !== ""
    });

    return res.json({ ok: true, businessId });
  } catch (err) {
    console.error("[update-calendar] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;


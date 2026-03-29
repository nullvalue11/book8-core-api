// src/routes/internalBusiness.js
import express from "express";
import { Business } from "../../models/Business.js";
import { isCalendarProviderAllowed } from "../config/plans.js";

const router = express.Router();

const VALID_PLANS = new Set(["starter", "growth", "enterprise"]);

// POST /internal/business/update-calendar
router.post("/update-calendar", async (req, res) => {
  try {
    const {
      businessId,
      calendarProvider,
      calendarConnected,
      timezone,
      primaryLanguage,
      multilingualEnabled,
      supportedLanguages,
      plan: bodyPlan
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
    const providerLc = provider ? String(provider).toLowerCase() : "";
    const connectingOutlook =
      providerLc === "microsoft" || providerLc === "outlook";

    if (connectingOutlook) {
      const plan = existing.plan || "starter";
      if (!isCalendarProviderAllowed(plan, "outlook")) {
        return res.status(403).json({
          ok: false,
          error: "Outlook calendar is available on Growth and Enterprise plans.",
          upgrade: true
        });
      }
    }

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
      plan: update.plan
    });

    return res.json({ ok: true, businessId });
  } catch (err) {
    console.error("[update-calendar] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;


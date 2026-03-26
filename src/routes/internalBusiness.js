// src/routes/internalBusiness.js
import express from "express";
import { Business } from "../../models/Business.js";

const router = express.Router();

// POST /internal/business/update-calendar
router.post("/update-calendar", async (req, res) => {
  try {
    const { businessId, calendarProvider, calendarConnected, timezone } = req.body || {};

    if (!businessId) {
      return res.status(400).json({ ok: false, error: "businessId required" });
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

    // Core-api uses "id" not "businessId" in the test database.
    const result = await Business.findOneAndUpdate(
      { id: businessId },
      { $set: update },
      { new: true }
    );

    if (!result) {
      // Try with businessId field as fallback
      const fallback = await Business.findOneAndUpdate(
        { businessId: businessId },
        { $set: update },
        { new: true }
      );

      if (!fallback) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      console.log("[update-calendar] Synced (via businessId):", {
        businessId,
        calendarProvider,
        calendarConnected,
        timezone: update.timezone
      });

      return res.json({ ok: true, businessId });
    }

    console.log("[update-calendar] Synced (via id):", {
      businessId,
      calendarProvider,
      calendarConnected,
      timezone: update.timezone
    });

    return res.json({ ok: true, businessId });
  } catch (err) {
    console.error("[update-calendar] Error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;


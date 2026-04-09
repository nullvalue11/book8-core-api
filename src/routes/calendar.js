// src/routes/calendar.js
import express from "express";
import { getAvailability } from "../../services/calendarAvailability.js";
import { publicBookingLimiter } from "../middleware/publicBookingLimiter.js";

const router = express.Router();

// POST /api/calendar/availability
router.post("/availability", publicBookingLimiter, async (req, res) => {
  try {
    const { businessId, serviceId, from, to, timezone, durationMinutes, providerId } = req.body;

    if (!businessId || !serviceId || !from || !to) {
      return res.status(400).json({
        ok: false,
        error: "Fields 'businessId', 'serviceId', 'from', and 'to' are required"
      });
    }

    const result = await getAvailability({
      businessId,
      serviceId,
      from,
      to,
      timezone,
      providerId: providerId || undefined
    });

    if (!result.ok) {
      if (result.subscriptionRequired) {
        const bid = encodeURIComponent(String(businessId));
        return res.status(402).json({
          ok: false,
          error: result.error,
          message: "Please select a plan for this location",
          upgradeUrl: `https://www.book8.io/setup?step=2&businessId=${bid}`,
          subscriptionRequired: true
        });
      }
      const notFound =
        result.error === "Business not found" ||
        result.error === "Service not found" ||
        result.error === "Provider not found";
      const status = notFound ? 404 : 400;
      return res.status(status).json({ ok: false, error: result.error });
    }

    return res.json({
      ok: true,
      businessId: result.businessId,
      serviceId: result.serviceId,
      timezone: result.timezone,
      providerId: result.providerId ?? null,
      slots: result.slots
    });
  } catch (err) {
    console.error("Error in POST /api/calendar/availability:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

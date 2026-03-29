// src/routes/calendar.js
import express from "express";
import { getAvailability } from "../../services/calendarAvailability.js";
import { strictLimiter } from "../middleware/strictLimiter.js";

const router = express.Router();

// POST /api/calendar/availability
router.post("/availability", strictLimiter, async (req, res) => {
  try {
    const { businessId, serviceId, from, to, timezone, durationMinutes } = req.body;

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
      timezone
    });

    if (!result.ok) {
      const status =
        result.error === "Business not found" || result.error === "Service not found" ? 404 : 400;
      return res.status(status).json({ ok: false, error: result.error });
    }

    return res.json({
      ok: true,
      businessId: result.businessId,
      serviceId: result.serviceId,
      timezone: result.timezone,
      slots: result.slots
    });
  } catch (err) {
    console.error("Error in POST /api/calendar/availability:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

// src/routes/calendar.js
import express from "express";
import { getAvailability } from "../../services/calendarAvailability.js";

const router = express.Router();

// POST /api/calendar/availability
router.post("/availability", async (req, res) => {
  try {
    const { businessId, serviceId, from, to, timezone, durationMinutes } = req.body;

    if (!businessId || !from || !to) {
      return res.status(400).json({
        ok: false,
        error: "Fields 'businessId', 'from', and 'to' are required"
      });
    }

    const result = await getAvailability({
      businessId,
      serviceId,
      from,
      to,
      timezone,
      durationMinutes: durationMinutes ?? 60
    });

    if (!result.ok) {
      const status = result.error === "Business not found" ? 404 : 400;
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

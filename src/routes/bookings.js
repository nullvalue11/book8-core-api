// src/routes/bookings.js
import express from "express";
import { createBooking } from "../../services/bookingService.js";
import { Booking } from "../../models/Booking.js";

const router = express.Router();

// GET /api/bookings?businessId=xxx
// Returns bookings for a business, sorted by slot start time
router.get("/", async (req, res) => {
  try {
    const { businessId, status, limit: limitParam } = req.query;

    if (!businessId) {
      return res.status(400).json({ ok: false, error: "businessId query parameter is required" });
    }

    const limit = Math.min(parseInt(limitParam) || 50, 100);
    const filter = { businessId };

    if (status) {
      filter.status = status;
    }

    const bookings = await Booking.find(filter)
      .sort({ "slot.start": -1 })
      .limit(limit)
      .lean();

    return res.json({ ok: true, businessId, bookings });
  } catch (err) {
    console.error("Error in GET /api/bookings:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /api/bookings
router.post("/", async (req, res) => {
  try {
    const { businessId, serviceId, customer, slot, notes, source } = req.body;

    if (!businessId || !serviceId) {
      return res.status(400).json({
        ok: false,
        error: "Fields 'businessId' and 'serviceId' are required"
      });
    }
    if (!customer || typeof customer !== "object") {
      return res.status(400).json({
        ok: false,
        error: "Field 'customer' (object with name) is required"
      });
    }
    if (!slot || typeof slot !== "object" || !slot.start || !slot.end || !slot.timezone) {
      return res.status(400).json({
        ok: false,
        error: "Field 'slot' (object with start, end, timezone) is required"
      });
    }

    const result = await createBooking({
      businessId,
      serviceId,
      customer,
      slot,
      notes,
      source
    });

    if (!result.ok) {
      const notFound = result.error === "Business not found" || result.error === "Service not found";
      const status = notFound ? 404 : 400;
      const conflict = result.error === "Selected slot is no longer available";
      const code = conflict ? 409 : status;
      return res.status(code).json({ ok: false, error: result.error });
    }

    return res.status(201).json({
      ok: true,
      booking: result.booking,
      summary: result.summary
    });
  } catch (err) {
    console.error("Error in POST /api/bookings:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

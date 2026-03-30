// src/routes/bookings.js
import express from "express";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import { createBooking } from "../../services/bookingService.js";
import { Booking } from "../../models/Booking.js";
import {
  deleteGcalEvent,
  resolveCalendarProviderForBusiness,
  updateGcalEvent
} from "../../services/gcalService.js";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { sendCancellation } from "../../services/emailService.js";

const router = express.Router();

/** Calendar + cancellation email after a booking is marked cancelled (fire-and-forget for async I/O). */
async function applyCancelSideEffects(booking) {
  const business = await Business.findOne({ id: booking.businessId }).lean();
  const calProvider = resolveCalendarProviderForBusiness(business);

  let serviceDisplay = booking.serviceId || "Appointment";
  try {
    const svc = await Service.findOne({ businessId: booking.businessId, serviceId: booking.serviceId }).lean();
    if (svc?.name) serviceDisplay = svc.name;
  } catch {
    // keep fallback
  }

  if (booking.calendarEventId && calProvider) {
    updateGcalEvent({
      businessId: booking.businessId,
      eventId: booking.calendarEventId,
      bookingId: booking.id || booking._id?.toString(),
      calendarProvider: calProvider,
      updates: {
        title: `CANCELLED — ${serviceDisplay}`,
        showAs: "free"
      }
    }).catch((err) => console.error("[bookings.cancel] Calendar update failed:", err.message));
  } else {
    deleteGcalEvent({
      businessId: booking.businessId,
      bookingId: booking.id || booking._id?.toString(),
      calendarProvider: calProvider
    }).catch((err) => console.error("[bookings.cancel] GCal delete failed:", err.message));
  }

  if (booking.customer?.email) {
    (async () => {
      try {
        let serviceDisplayEmail = booking.serviceId || "Appointment";
        let serviceForEmail = { name: serviceDisplayEmail };
        try {
          const svc = await Service.findOne({ businessId: booking.businessId, serviceId: booking.serviceId }).lean();
          if (svc?.name) {
            serviceDisplayEmail = svc.name;
            serviceForEmail = svc;
          }
        } catch {
          // keep fallback
        }
        await sendCancellation(
          booking,
          business || { id: booking.businessId, name: booking.businessId },
          serviceForEmail,
          booking.customer
        );
      } catch (err) {
        console.error("[bookings.cancel] Cancellation email failed:", err.message);
      }
    })().catch(() => {});
  }
}

// GET /api/bookings?businessId=xxx
// Returns bookings for a business, sorted by slot start time
router.get("/", strictLimiter, async (req, res) => {
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
router.post("/", strictLimiter, async (req, res) => {
  try {
    const { businessId, serviceId, customer, slot, notes, source, language } = req.body;

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
      source,
      language
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

/**
 * POST /api/bookings/cancel-by-slot
 * book8-ai: cancel by business + slot when core-api booking id is unknown (calendar propagation).
 * Auth: internal secret (same as PATCH cancel).
 */
router.post("/cancel-by-slot", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { businessId, slot } = req.body || {};

    if (!businessId || !slot || typeof slot !== "object" || !slot.start) {
      return res.status(400).json({
        ok: false,
        error: "businessId and slot.start are required"
      });
    }

    const rawStart = String(slot.start).trim();
    const startMs = new Date(rawStart).getTime();
    if (Number.isNaN(startMs)) {
      return res.status(400).json({ ok: false, error: "slot.start must be a valid date/time" });
    }
    const isoStart = new Date(startMs).toISOString();

    let booking = await Booking.findOne({
      businessId,
      status: "confirmed",
      "slot.start": rawStart
    });

    if (!booking) {
      booking = await Booking.findOne({
        businessId,
        status: "confirmed",
        "slot.start": isoStart
      });
    }

    if (!booking) {
      return res.status(404).json({ ok: false, error: "Booking not found for slot" });
    }

    if (slot.end) {
      const rawEnd = String(slot.end).trim();
      const endMs = new Date(rawEnd).getTime();
      if (Number.isNaN(endMs)) {
        return res.status(400).json({ ok: false, error: "slot.end must be a valid date/time when provided" });
      }
      const isoEnd = new Date(endMs).toISOString();
      const storedEnd = booking.slot?.end;
      const endOk =
        storedEnd === rawEnd ||
        storedEnd === isoEnd ||
        storedEnd === new Date(rawEnd).toISOString();
      if (!endOk) {
        return res.status(404).json({ ok: false, error: "Booking not found for slot" });
      }
    }

    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: "confirmed" },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancellationMethod: "dashboard"
        }
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(409).json({
        ok: false,
        error: "Booking could not be cancelled (may have been modified)"
      });
    }

    await applyCancelSideEffects(updated);
    return res.json({ ok: true, booking: updated });
  } catch (err) {
    console.error("Error in POST /api/bookings/cancel-by-slot:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// PATCH /api/bookings/:bookingId/cancel (dashboard/ops — internal secret required)
router.patch("/:bookingId/cancel", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!bookingId) {
      return res.status(400).json({ ok: false, error: "bookingId is required" });
    }

    const booking = await Booking.findOneAndUpdate(
      { $or: [{ id: bookingId }, { _id: bookingId }] },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancellationMethod: "api"
        }
      },
      { new: true }
    ).lean();

    if (!booking) {
      return res.status(404).json({ ok: false, error: "Booking not found" });
    }

    await applyCancelSideEffects(booking);
    return res.json({ ok: true, booking });
  } catch (err) {
    console.error("Error in PATCH /api/bookings/:bookingId/cancel:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

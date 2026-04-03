// src/routes/bookings.js
import express from "express";
import mongoose from "mongoose";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import { requireChannel } from "../middleware/planCheck.js";
import { createBooking } from "../../services/bookingService.js";
import { Booking } from "../../models/Booking.js";
import {
  deleteGcalEvent,
  resolveCalendarProviderForBusiness,
  updateGcalEvent
} from "../../services/gcalService.js";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { sendCancellation, sendCancellationWithFeeEmail } from "../../services/emailService.js";
import { tryChargeCancellationFee } from "../../services/bookingFeeCharge.js";

const router = express.Router();

/** Match by custom `id` (e.g. bk_…) and/or Mongo `_id` without casting bk_* to ObjectId. */
function bookingLookupFilter(bookingId) {
  const or = [{ id: bookingId }];
  if (mongoose.isValidObjectId(bookingId)) {
    or.push({ _id: bookingId });
  }
  return { $or: or };
}

function requireBookingChannelBySource(req, res, next) {
  const source = req.body?.source || req.body?.input?.source;
  if (source === "voice-agent" || source === "voice") {
    return requireChannel("voice")(req, res, next);
  }
  if (source === "sms") {
    return requireChannel("sms")(req, res, next);
  }
  next();
}

/** Calendar + cancellation email after a booking is marked cancelled (fire-and-forget for async I/O). */
async function applyCancelSideEffects(booking, options = {}) {
  const { cancellationFeeAmount } = options;
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
        if (cancellationFeeAmount != null && cancellationFeeAmount > 0) {
          await sendCancellationWithFeeEmail(
            booking,
            business || { id: booking.businessId, name: booking.businessId },
            serviceForEmail,
            booking.customer,
            { amountMajor: cancellationFeeAmount }
          );
        } else {
          await sendCancellation(
            booking,
            business || { id: booking.businessId, name: booking.businessId },
            serviceForEmail,
            booking.customer
          );
        }
      } catch (err) {
        console.error("[bookings.cancel] Cancellation email failed:", err.message);
      }
    })().catch(() => {});
  }
}

// GET /api/bookings?businessId=xxx
// Returns bookings for a business, sorted by slot start time (dashboard only — customer PII).
router.get("/", requireInternalAuth, strictLimiter, async (req, res) => {
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
router.post("/", strictLimiter, requireBookingChannelBySource, async (req, res) => {
  try {
    const { businessId, serviceId, customer, slot, notes, source, language, lang, providerId, providerName } =
      req.body;

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
      language: language ?? lang,
      providerId,
      providerName
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
    const slotStart = req.body.slot?.start || req.body.slotStart;

    if (!businessId || slotStart == null || String(slotStart).trim() === "") {
      return res.status(400).json({
        ok: false,
        error: "businessId and slot.start (or slotStart) are required"
      });
    }

    const rawStart = String(slotStart).trim();
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

    const businessForFee = await Business.findOne({
      $or: [{ id: businessId }, { businessId }]
    }).lean();
    const serviceForFee = await Service.findOne({
      businessId,
      serviceId: booking.serviceId
    }).lean();
    const feeTry = await tryChargeCancellationFee(booking.toObject(), businessForFee, serviceForFee);
    if (!feeTry.ok) {
      return res.status(402).json({
        ok: false,
        error: feeTry.error || "Cancellation fee could not be charged"
      });
    }

    const slotEnd = slot?.end || req.body.slotEnd;
    if (slotEnd) {
      const rawEnd = String(slotEnd).trim();
      const endMs = new Date(rawEnd).getTime();
      if (Number.isNaN(endMs)) {
        return res.status(400).json({ ok: false, error: "slot end must be a valid date/time when provided" });
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

    const feeSet =
      feeTry.charged && feeTry.paymentIntentId
        ? {
            cancellationFeeCharged: true,
            cancellationFeeChargedAt: new Date(),
            cancellationFeeAmount: feeTry.amountMajor,
            cancellationFeeChargeId: feeTry.paymentIntentId
          }
        : {};

    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: "confirmed" },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancellationMethod: "dashboard",
          smsCancelAwaitingConfirm: false,
          ...feeSet
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

    await applyCancelSideEffects(updated, {
      cancellationFeeAmount: feeTry.charged ? feeTry.amountMajor : undefined
    });
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

    const bookingDoc = await Booking.findOne({
      ...bookingLookupFilter(bookingId),
      status: "confirmed"
    });

    if (!bookingDoc) {
      return res.status(404).json({
        ok: false,
        error: "Booking not found or already cancelled"
      });
    }

    const businessForFee = await Business.findOne({
      $or: [{ id: bookingDoc.businessId }, { businessId: bookingDoc.businessId }]
    }).lean();
    const serviceForFee = await Service.findOne({
      businessId: bookingDoc.businessId,
      serviceId: bookingDoc.serviceId
    }).lean();
    const feeTry = await tryChargeCancellationFee(bookingDoc.toObject(), businessForFee, serviceForFee);
    if (!feeTry.ok) {
      return res.status(402).json({
        ok: false,
        error: feeTry.error || "Cancellation fee could not be charged"
      });
    }

    const feeSet =
      feeTry.charged && feeTry.paymentIntentId
        ? {
            cancellationFeeCharged: true,
            cancellationFeeChargedAt: new Date(),
            cancellationFeeAmount: feeTry.amountMajor,
            cancellationFeeChargeId: feeTry.paymentIntentId
          }
        : {};

    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingDoc._id,
        status: "confirmed"
      },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancellationMethod: "api",
          smsCancelAwaitingConfirm: false,
          ...feeSet
        }
      },
      { new: true }
    ).lean();

    if (!booking) {
      return res.status(409).json({
        ok: false,
        error: "Booking could not be cancelled (may have been modified)"
      });
    }

    await applyCancelSideEffects(booking, {
      cancellationFeeAmount: feeTry.charged ? feeTry.amountMajor : undefined
    });
    return res.json({ ok: true, booking });
  } catch (err) {
    console.error("Error in PATCH /api/bookings/:bookingId/cancel:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

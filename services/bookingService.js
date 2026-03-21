/**
 * Booking creation and slot availability check.
 */

import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { formatSlotDisplay } from "./slotDisplay.js";
import { randomBytes } from "crypto";
import { sendSMS, formatConfirmationSMS } from "./smsService.js";
import { sendConfirmation as sendConfirmationEmail } from "./emailService.js";
import { createGcalEvent, resolveCalendarProviderForBusiness } from "./gcalService.js";

/**
 * Generate a stable booking id (e.g. bk_01JQBOOK8XYZ).
 */
export function generateBookingId() {
  const suffix = randomBytes(9).toString("base64url").replace(/[-_]/g, "X").slice(0, 12);
  return `bk_${suffix}`;
}

/**
 * Check if the given slot is still available (not double-booked).
 * Ensures no existing confirmed booking for this business overlaps the slot.
 *
 * NOTE: This is a soft check (read-only). The real atomicity guarantee comes
 * from the compound unique index on Booking { businessId, slot.start, status }.
 * See createBooking() below for the catch on duplicate key errors.
 */
export async function isSlotAvailable(businessId, slot) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return false;
  }
  const overlapping = await Booking.findOne({
    businessId,
    status: "confirmed",
    $or: [
      { "slot.start": { $lt: slot.end }, "slot.end": { $gt: slot.start } }
    ]
  }).lean();
  return !overlapping;
}

/**
 * Create a booking. Validates business, checks slot availability, then persists.
 *
 * RACE CONDITION SAFETY:
 * Even though isSlotAvailable() runs first as a soft check, two concurrent
 * requests can both pass it. The compound unique index on Booking
 * { businessId, slot.start, status } ensures the second save() fails with
 * a duplicate key error (MongoDB code 11000). We catch that and return a
 * clean "slot no longer available" response — no double-booking possible.
 *
 * @param {object} input
 * @returns {Promise<{ ok: boolean, error?: string, booking?: object, summary?: string }>}
 */
export async function createBooking(input) {
  const { businessId, serviceId, customer, slot: rawSlot, notes, source, timezone: inputTimezone } = input;

  if (!businessId || !serviceId) {
    return { ok: false, error: "businessId and serviceId are required" };
  }
  if (!customer?.name) {
    return { ok: false, error: "Customer name is required" };
  }

  // Normalize slot: voice agent may send only start (string) or { start } without end
  let slot = rawSlot;
  if (typeof slot === "string") {
    slot = { start: slot, end: undefined, timezone: inputTimezone || "America/Toronto" };
  }
  if (!slot || !slot.start) {
    return { ok: false, error: "Slot start, end, and timezone are required" };
  }
  if (!slot.timezone) {
    slot.timezone = inputTimezone || "America/Toronto";
  }

  const business = await Business.findOne({ id: businessId }).lean();
  if (!business) {
    return { ok: false, error: "Business not found" };
  }

  const service = await Service.findOne({ businessId, serviceId }).lean();
  if (!service) {
    return { ok: false, error: "Service not found" };
  }
  if (!service.active) {
    return { ok: false, error: "Service is not active" };
  }

  // Voice agent often sends only slot start; derive end from service duration
  if (!slot.end) {
    const startMs = new Date(slot.start).getTime();
    if (Number.isNaN(startMs)) {
      return { ok: false, error: "Slot start must be a valid date/time" };
    }
    slot.end = new Date(startMs + service.durationMinutes * 60000).toISOString();
  }

  const slotDurationMs = new Date(slot.end) - new Date(slot.start);
  const slotDurationMinutes = Math.round(slotDurationMs / 60000);
  if (slotDurationMinutes < service.durationMinutes) {
    return { ok: false, error: "Slot duration is shorter than service duration" };
  }
  if (slotDurationMinutes > service.durationMinutes + 15) {
    return { ok: false, error: "Slot duration does not match service duration" };
  }

  // Normalize to UTC ISO strings so overlap check and unique index use consistent format.
  // Mixed formats (e.g. "13:00:00-04:00" vs "17:00:00.000Z") break string comparison in MongoDB.
  const normStart = new Date(slot.start).toISOString();
  const normEnd = new Date(slot.end).toISOString();
  const slotForQuery = { start: normStart, end: normEnd };

  const available = await isSlotAvailable(businessId, slotForQuery);
  if (!available) {
    return { ok: false, error: "Selected slot is no longer available" };
  }

  const bookingId = generateBookingId();
  const timezone = slot.timezone || business.timezone || "America/Toronto";

  const booking = new Booking({
    id: bookingId,
    businessId,
    serviceId: serviceId || "",
    customer: {
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || ""
    },
    slot: {
      start: normStart,
      end: normEnd,
      timezone
    },
    status: "confirmed",
    source: source || "voice-agent",
    notes: notes || ""
  });

  try {
    await booking.save();
  } catch (err) {
    if (err.code === 11000) {
      console.warn(
        `[bookingService] Duplicate key on save — concurrent booking race caught. ` +
          `businessId=${businessId}, slot.start=${normStart}`
      );
      return { ok: false, error: "Selected slot is no longer available" };
    }
    throw err;
  }

  // ── SEND BOOKING CONFIRMATION SMS ────────────────────────
  // Fire-and-forget: don't block the booking response on SMS delivery
  // The booking is already saved — SMS is a best-effort notification
  (async () => {
    try {
      if (!customer.phone) {
        console.log("[bookingService] No customer phone — skipping confirmation SMS");
        return;
      }

      const bizForSms = await Business.findOne({ id: businessId }).lean();
      const fromNumber = bizForSms?.assignedTwilioNumber;
      if (!fromNumber) {
        console.log("[bookingService] No assignedTwilioNumber for business — skipping SMS");
        return;
      }

      const bizTz = bizForSms?.timezone || timezone || "America/Toronto";
      const slotDate = new Date(normStart);
      const dateStr = slotDate.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: bizTz
      });
      const timeStr = slotDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: bizTz
      });

      let serviceName = serviceId || "Appointment";
      try {
        const svc = await Service.findOne({ businessId, serviceId }).lean();
        if (svc) serviceName = svc.name;
      } catch {
        // fallback to serviceId
      }

      const smsBody = formatConfirmationSMS({
        serviceName,
        businessName: bizForSms.name || businessId,
        date: dateStr,
        time: timeStr,
        customerName: customer.name?.split(" ")[0] || ""
      });

      const smsResult = await sendSMS({
        to: customer.phone,
        from: fromNumber,
        body: smsBody
      });

      if (smsResult.ok) {
        await Booking.findOneAndUpdate(
          { id: bookingId },
          { $set: { confirmationSentAt: new Date(), confirmationSid: smsResult.messageSid } }
        );
        console.log("[bookingService] Confirmation SMS sent for booking:", bookingId);
      } else {
        console.warn("[bookingService] Confirmation SMS failed for booking:", bookingId, smsResult.error);
      }
    } catch (smsErr) {
      console.error("[bookingService] Error in confirmation SMS flow:", smsErr);
    }
  })().catch(() => {});
  // ── END SMS BLOCK ────────────────────────────────────────

  console.log("[bookingService] Email check:", {
    hasEmail: !!customer?.email,
    email: customer?.email,
    hasResendKey: !!process.env.RESEND_API_KEY
  });

  if (customer.email) {
    sendConfirmationEmail(booking, business, service, customer)
      .then(async (result) => {
        if (result?.id) {
          await Booking.findOneAndUpdate(
            { id: bookingId },
            { $set: { confirmationEmailSentAt: new Date(), confirmationEmailId: result.id } }
          );
        }
      })
      .catch((err) => console.error("[bookingService] Email failed:", err.message));
  }

  // Calendar sync (fire-and-forget) — provider from top-level or nested `calendar` (book8-ai shape)
  try {
    const resolvedCalendarProvider = resolveCalendarProviderForBusiness(business);
    if (process.env.NODE_ENV !== "test") {
      console.log("[gcalService] Business calendar state:", {
        businessId: business.id,
        calendarProvider: business.calendarProvider,
        calendarConnected: business.calendar?.connected,
        calendarProviderNested: business.calendar?.provider,
        resolved: resolvedCalendarProvider
      });
    }
    createGcalEvent({
      businessId: booking.businessId,
      bookingId: booking.id,
      title: `${service?.name || "Appointment"} — ${customer.name}`,
      description: [
        `Service: ${service?.name || "Appointment"}`,
        `Customer: ${customer.name}`,
        customer.phone ? `Phone: ${customer.phone}` : null,
        customer.email ? `Email: ${customer.email}` : null,
        "Booked via Book8 AI"
      ]
        .filter(Boolean)
        .join("\n"),
      start: booking.slot.start,
      end: booking.slot.end,
      timezone: booking.slot.timezone || business.timezone || "America/Toronto",
      calendarProvider: resolvedCalendarProvider,
      customer: {
        name: customer.name,
        phone: customer.phone,
        email: customer.email
      }
    })
      .then(async (calResult) => {
        if (calResult?.eventId) {
          await Booking.findOneAndUpdate(
            { id: bookingId },
            { $set: { calendarEventId: calResult.eventId } }
          );
          console.log("[bookingService] Stored calendarEventId:", calResult.eventId, "on booking:", bookingId);
        }
      })
      .catch((err) => console.error("[bookingService] GCal sync failed:", err.message));
  } catch (err) {
    console.error("[bookingService] GCal sync setup error:", err.message);
  }

  const display = formatSlotDisplay(normStart, timezone);
  const summary = `Booked ${customer.name} for ${display}.`;

  return {
    ok: true,
    booking: {
      id: booking.id,
      businessId: booking.businessId,
      serviceId: booking.serviceId,
      customer: booking.customer,
      slot: booking.slot,
      status: booking.status
    },
    summary
  };
}

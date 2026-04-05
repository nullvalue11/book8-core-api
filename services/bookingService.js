/**
 * Booking creation and slot availability check.
 */

import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { Provider } from "../models/Provider.js";
import { formatSlotDisplay } from "./slotDisplay.js";
import { randomBytes } from "crypto";
import { sendSMS, formatConfirmationSMS } from "./smsService.js";
import { formatSlotDateTime } from "./localeFormat.js";
import { sendConfirmation as sendConfirmationEmail } from "./emailService.js";
import { createGcalEvent, resolveCalendarProviderForBusiness } from "./gcalService.js";
import { isFeatureAllowed } from "../src/config/plans.js";
import { tryMarkWaitlistBooked } from "./waitlistService.js";
import { validateAndBuildRecurringMeta } from "./recurringBookingUtils.js";
import {
  sendRecurringInitialConfirmations,
  sendRecurringNextConfirmations
} from "./recurringBookingMessages.js";

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
export async function isSlotAvailable(businessId, slot, providerId = null) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return false;
  }
  const q = {
    businessId,
    status: "confirmed",
    "slot.start": { $lt: slot.end },
    "slot.end": { $gt: slot.start }
  };
  if (providerId) {
    q.$or = [
      { providerId },
      { providerId: null },
      { providerId: { $exists: false } }
    ];
  }
  const overlapping = await Booking.findOne(q).lean();
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
  const {
    businessId,
    serviceId,
    customer,
    slot: rawSlot,
    notes,
    source,
    timezone: inputTimezone,
    language: inputLanguageRaw,
    lang: inputLangAlias,
    providerId: inputProviderId,
    providerName: inputProviderName,
    waitlistId,
    recurring: recurringInput,
    recurringMetadata: recurringMetadataInput,
    _recurringCron: isRecurringCron
  } = input;

  const inputLanguage = inputLanguageRaw ?? inputLangAlias;

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

  let resolvedProviderName =
    typeof inputProviderName === "string" && inputProviderName.trim()
      ? inputProviderName.trim().slice(0, 200)
      : null;
  if (inputProviderId) {
    const prov = await Provider.findOne({ businessId, id: String(inputProviderId).trim() }).lean();
    if (!prov) {
      return { ok: false, error: "Provider not found" };
    }
    if (!prov.isActive) {
      return { ok: false, error: "Provider is not active" };
    }
    if (Array.isArray(prov.services) && prov.services.length > 0 && !prov.services.includes(serviceId)) {
      return { ok: false, error: "Service is not offered by this provider" };
    }
    if (!resolvedProviderName && prov.name) {
      resolvedProviderName = prov.name;
    }
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
  const minDuration = service.durationMinutes - 5;
  const maxDuration = service.durationMinutes + 30;
  if (slotDurationMinutes < minDuration || slotDurationMinutes > maxDuration) {
    return { ok: false, error: "Slot duration does not match service duration" };
  }

  // Normalize to UTC ISO strings so overlap check and unique index use consistent format.
  // Mixed formats (e.g. "13:00:00-04:00" vs "17:00:00.000Z") break string comparison in MongoDB.
  const normStart = new Date(slot.start).toISOString();
  const normEnd = new Date(slot.end).toISOString();
  const slotForQuery = { start: normStart, end: normEnd };

  let recurringDoc = undefined;
  if (recurringMetadataInput && isRecurringCron) {
    recurringDoc = recurringMetadataInput;
  } else if (recurringInput?.enabled) {
    const vr = validateAndBuildRecurringMeta({
      plan: business.plan,
      recurring: recurringInput,
      normStartIso: normStart,
      timezone: slot.timezone || business.timezone || "America/Toronto",
      serviceDurationMinutes: service.durationMinutes
    });
    if (!vr.ok) {
      return {
        ok: false,
        error: vr.error,
        upgrade: !!vr.upgrade,
        requiredPlan: vr.requiredPlan
      };
    }
    recurringDoc = vr.recurring;
  }

  const providerForSlot = inputProviderId ? String(inputProviderId).trim() : null;
  const available = await isSlotAvailable(businessId, slotForQuery, providerForSlot);
  if (!available) {
    return { ok: false, error: "Selected slot is no longer available" };
  }

  const bookingId = generateBookingId();
  const timezone = slot.timezone || business.timezone || "America/Toronto";

  const booking = new Booking({
    id: bookingId,
    businessId,
    serviceId: serviceId || "",
    providerId: providerForSlot || undefined,
    providerName: resolvedProviderName || undefined,
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
    source: source || "web",
    language:
      typeof inputLanguage === "string" && inputLanguage.trim()
        ? inputLanguage.trim().toLowerCase().slice(0, 5)
        : "en",
    notes: notes || "",
    ...(recurringDoc ? { recurring: recurringDoc } : {})
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

  if (waitlistId && typeof waitlistId === "string") {
    try {
      await tryMarkWaitlistBooked(waitlistId, booking.toObject());
    } catch (wlErr) {
      console.warn("[bookingService] waitlistId:", wlErr.message);
    }
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

      const smsPlan = bizForSms.plan || "starter";
      if (!isFeatureAllowed(smsPlan, "smsConfirmations")) {
        console.log(
          `[bookingService] SMS confirmation skipped — plan has no SMS confirmations (${businessId}, plan=${smsPlan})`
        );
        return;
      }

      const bizTz = bizForSms?.timezone || timezone || "America/Toronto";
      const smsLang = booking.language || "en";
      const { dateStr, timeStr } = formatSlotDateTime(normStart, bizTz, smsLang);

      let serviceName = serviceId || "Appointment";
      try {
        const svc = await Service.findOne({ businessId, serviceId }).lean();
        if (svc) serviceName = svc.name;
      } catch {
        // fallback to serviceId
      }

      let smsBody;
      if (booking.recurring?.enabled && isRecurringCron) {
        smsBody = sendRecurringNextConfirmations.buildSms({
          serviceName,
          businessName: bizForSms.name || businessId,
          date: dateStr,
          time: timeStr,
          language: smsLang
        });
      } else if (booking.recurring?.enabled && booking.recurring.occurrenceNumber === 1) {
        smsBody = sendRecurringInitialConfirmations.buildSms({
          serviceName,
          businessName: bizForSms.name || businessId,
          date: dateStr,
          time: timeStr,
          occurrence: booking.recurring.occurrenceNumber,
          total: booking.recurring.totalOccurrences,
          language: smsLang
        });
      } else {
        smsBody = formatConfirmationSMS({
          serviceName,
          businessName: bizForSms.name || businessId,
          date: dateStr,
          time: timeStr,
          customerName: customer.name?.split(" ")[0] || "",
          language: smsLang
        });
      }

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
    hasResendKey: !!process.env.RESEND_API_KEY
  });

  if (customer.email && isFeatureAllowed(business.plan || "starter", "emailConfirmations")) {
    const bookingForEmail = typeof booking.toObject === "function" ? booking.toObject() : booking;
    const emailPromise =
      booking.recurring?.enabled && isRecurringCron
        ? sendRecurringNextConfirmations.sendEmail(bookingForEmail, business, service, customer)
        : booking.recurring?.enabled && booking.recurring.occurrenceNumber === 1
          ? sendRecurringInitialConfirmations.sendEmail(bookingForEmail, business, service, customer)
          : sendConfirmationEmail(bookingForEmail, business, service, customer);

    emailPromise
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

  const bookingOut = {
    id: booking.id,
    businessId: booking.businessId,
    serviceId: booking.serviceId,
    providerId: booking.providerId ?? null,
    providerName: booking.providerName ?? null,
    customer: booking.customer,
    slot: booking.slot,
    status: booking.status,
    language: booking.language
  };
  if (booking.recurring) {
    bookingOut.recurring = booking.recurring;
    if (booking.recurring.seriesId) {
      bookingOut.seriesId = booking.recurring.seriesId;
    }
  }

  return {
    ok: true,
    booking: bookingOut,
    summary
  };
}

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
import { invalidateFreebusyCacheForBusiness } from "../src/services/gcalBusyCache.js";
import { isFeatureAllowed, isChannelAllowed } from "../src/config/plans.js";
import { tryMarkWaitlistBooked } from "./waitlistService.js";
import { validateAndBuildRecurringMeta } from "./recurringBookingUtils.js";
import {
  sendRecurringInitialConfirmations,
  sendRecurringNextConfirmations
} from "./recurringBookingMessages.js";
import { getTrialBookingBlock } from "../src/utils/trialLifecycle.js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDays, format, parseISO } from "date-fns";
import { hashPhoneForLog } from "../src/utils/maskPhone.js";

/**
 * Generate a stable booking id (e.g. bk_01JQBOOK8XYZ).
 */
export function generateBookingId() {
  const suffix = randomBytes(9).toString("base64url").replace(/[-_]/g, "X").slice(0, 12);
  return `bk_${suffix}`;
}

/** BOO-91A: trim + lowercase for stored customer emails and dedupe */
export function normalizeCustomerEmail(raw) {
  if (raw == null || raw === "") return "";
  return String(raw).trim().toLowerCase();
}

/** BOO-84A: international E.164 (+971…, +44…, etc.) */
export function isValidE164Phone(phone) {
  if (phone == null || phone === "") return true;
  const p = String(phone).trim().replace(/\s/g, "");
  if (!p) return true;
  return /^\+[1-9]\d{1,14}$/.test(p);
}

function normalizeClientRequestId(raw) {
  if (raw == null || typeof raw !== "string") return "";
  return raw.trim().slice(0, 128);
}

function bookingToPublicOut(booking) {
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
  return bookingOut;
}

/**
 * SMS, email, and calendar sync after a successful save. Does not throw.
 */
async function runBookingConfirmationSideEffects({
  bookingId,
  booking,
  business,
  businessId,
  service,
  serviceId,
  customer,
  normStart,
  timezone,
  isRecurringCron
}) {
  const tasks = [
    (async () => {
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
    })(),

    (async () => {
      console.log("[bookingService] Email check:", {
        hasEmail: !!customer?.email,
        hasResendKey: !!process.env.RESEND_API_KEY
      });

      if (!customer.email || !isFeatureAllowed(business.plan || "starter", "emailConfirmations")) {
        return;
      }

      const bookingForEmail = typeof booking.toObject === "function" ? booking.toObject() : booking;
      const emailPromise =
        booking.recurring?.enabled && isRecurringCron
          ? sendRecurringNextConfirmations.sendEmail(bookingForEmail, business, service, customer)
          : booking.recurring?.enabled && booking.recurring.occurrenceNumber === 1
            ? sendRecurringInitialConfirmations.sendEmail(bookingForEmail, business, service, customer)
            : sendConfirmationEmail(bookingForEmail, business, service, customer);

      const result = await emailPromise;
      if (result?.id) {
        await Booking.findOneAndUpdate(
          { id: bookingId },
          { $set: { confirmationEmailSentAt: new Date(), confirmationEmailId: result.id } }
        );
      }
    })(),

    (async () => {
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
      const calResult = await createGcalEvent({
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
      });
      if (calResult?.eventId) {
        await Booking.findOneAndUpdate(
          { id: bookingId },
          { $set: { calendarEventId: calResult.eventId } }
        );
        console.log("[bookingService] Stored calendarEventId:", calResult.eventId, "on booking:", bookingId);
      }
    })()
  ];

  const results = await Promise.allSettled(tasks);
  results.forEach((r, idx) => {
    if (r.status === "rejected") {
      const labels = ["sms", "email", "gcal"];
      console.error("[booking-side-effect-failed]", {
        bookingId,
        sideEffect: labels[idx] || idx,
        error: r.reason?.message || String(r.reason)
      });
    }
  });
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
 * @returns {Promise<{ ok: boolean, error?: string, booking?: object, summary?: string, idempotent?: boolean }>}
 */
async function createBookingInner(input) {
  const {
    businessId,
    serviceId,
    customer: customerInput,
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
    _recurringCron: isRecurringCron,
    clientRequestId: inputClientRequestId
  } = input;

  const inputLanguage = inputLanguageRaw ?? inputLangAlias;
  const normalizedReqId = normalizeClientRequestId(inputClientRequestId);

  if (!businessId || !serviceId) {
    return { ok: false, error: "businessId and serviceId are required" };
  }
  if (!customerInput?.name) {
    return { ok: false, error: "Customer name is required" };
  }
  if (customerInput?.phone && !isValidE164Phone(customerInput.phone)) {
    return { ok: false, error: "invalid_phone" };
  }

  const customer = {
    ...customerInput,
    email: normalizeCustomerEmail(customerInput.email)
  };

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

  const trialBlock = getTrialBookingBlock(business, { source });
  if (trialBlock) {
    return trialBlock;
  }

  if (normalizedReqId) {
    const prior = await Booking.findOne({
      businessId,
      clientRequestId: normalizedReqId,
      status: "confirmed"
    }).lean();
    if (prior) {
      const tz = prior.slot?.timezone || business.timezone || "America/Toronto";
      const display = formatSlotDisplay(prior.slot.start, tz);
      return {
        ok: true,
        idempotent: true,
        booking: bookingToPublicOut(prior),
        summary: `Booked ${prior.customer?.name || ""} for ${display}.`
      };
    }
  }

  const custEmail = (customer?.email || "").trim().toLowerCase();
  if (custEmail) {
    const ownerCandidates = [business?.email, business?.businessProfile?.email]
      .filter(Boolean)
      .map((e) => String(e).toLowerCase());
    if (ownerCandidates.includes(custEmail)) {
      console.log("[booking-attempt] ownerBookingHint", { businessId, customerEmail: custEmail });
    }
  }

  const plan = business.plan && String(business.plan).toLowerCase() !== "none" ? business.plan : "none";
  const src = String(source || "web").toLowerCase();
  let channel = "web";
  if (src === "voice-agent" || src === "voice") channel = "voice";
  else if (src === "sms") channel = "sms";

  if (!isChannelAllowed(plan, channel)) {
    return {
      ok: false,
      error:
        plan === "none" || !business.plan
          ? "This business requires an active subscription before accepting bookings."
          : `${channel} booking is not available on the current plan.`,
      subscriptionRequired: plan === "none" || !business.plan,
      upgrade: true
    };
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
      email: customer.email
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
    ...(recurringDoc ? { recurring: recurringDoc } : {}),
    ...(normalizedReqId ? { clientRequestId: normalizedReqId } : {})
  });

  try {
    await booking.save();
  } catch (err) {
    if (err.code === 11000) {
      if (normalizedReqId) {
        const prior = await Booking.findOne({ businessId, clientRequestId: normalizedReqId }).lean();
        if (prior) {
          const tz = prior.slot?.timezone || business.timezone || "America/Toronto";
          const display = formatSlotDisplay(prior.slot.start, tz);
          return {
            ok: true,
            idempotent: true,
            booking: bookingToPublicOut(prior),
            summary: `Booked ${prior.customer?.name || ""} for ${display}.`
          };
        }
      }
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

  invalidateFreebusyCacheForBusiness(businessId);

  void runBookingConfirmationSideEffects({
    bookingId,
    booking,
    business,
    businessId,
    service,
    serviceId,
    customer,
    normStart,
    timezone,
    isRecurringCron
  }).catch((e) => console.error("[bookingService] side effects runner:", e?.message));

  const display = formatSlotDisplay(normStart, timezone);
  const summary = `Booked ${customer.name} for ${display}.`;

  return {
    ok: true,
    booking: bookingToPublicOut(booking.toObject ? booking.toObject() : booking),
    summary
  };
}

export async function createBooking(input) {
  try {
    return await createBookingInner(input);
  } catch (err) {
    console.error("[booking-failed]", {
      stage: "unexpected",
      errorName: err?.name,
      errorMessage: err?.message,
      errorCode: err?.code,
      stack: err?.stack
    });
    return { ok: false, error: "booking_creation_failed" };
  }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** BOO-97A: strict non-empty E.164 for voice lookup input. */
export function isE164LookupPhone(phone) {
  if (phone == null) return false;
  const t = String(phone).trim().replace(/\s/g, "");
  if (!t) return false;
  return /^\+[1-9]\d{1,14}$/.test(t);
}

/** BOO-97A: normalize stored/input phone to canonical E.164 when possible. */
export function normalizePhoneForLookupMatch(phone) {
  if (phone == null || phone === "") return "";
  const s = String(phone).trim().replace(/\s/g, "");
  if (!s) return "";
  if (/^\+[1-9]\d{1,14}$/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return "";
}

function phoneQueryVariants(e164) {
  const set = new Set([e164]);
  if (e164.startsWith("+")) set.add(e164.slice(1));
  return [...set];
}

function slotDurationMinutes(slot) {
  const a = new Date(slot?.start);
  const b = new Date(slot?.end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

/**
 * BOO-97A: internal voice-agent lookup — phone is the auth key; results filtered after query.
 * @returns {Promise<{ ok: true, count: number, bookings: object[] } | { ok: false, error: string }>}
 */
export async function lookupBookingsByPhone(input) {
  const {
    businessId,
    customerPhone,
    dateFrom: dateFromIn,
    dateTo: dateToIn,
    includeCancelled = false,
    limit: limitIn
  } = input || {};

  if (!businessId || typeof businessId !== "string" || !businessId.trim()) {
    return { ok: false, error: "businessId is required" };
  }

  if (!isE164LookupPhone(customerPhone)) {
    return { ok: false, error: "Invalid phone" };
  }

  const normalizedInput = String(customerPhone).trim().replace(/\s/g, "");

  let limit = Number(limitIn);
  if (!Number.isFinite(limit) || limit < 1) limit = 5;
  limit = Math.min(Math.max(Math.floor(limit), 1), 10);

  const bizId = businessId.trim();
  const business = await Business.findOne({ id: bizId }).lean();
  const tz = business?.timezone || "America/Toronto";

  let fromYmd = dateFromIn;
  let toYmd = dateToIn;
  if (fromYmd != null) {
    if (typeof fromYmd !== "string" || !YMD_RE.test(fromYmd.trim())) {
      return { ok: false, error: "Invalid dateFrom" };
    }
    fromYmd = fromYmd.trim();
  } else {
    fromYmd = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  }
  if (toYmd != null) {
    if (typeof toYmd !== "string" || !YMD_RE.test(toYmd.trim())) {
      return { ok: false, error: "Invalid dateTo" };
    }
    toYmd = toYmd.trim();
  } else {
    toYmd = format(addDays(parseISO(`${fromYmd}T12:00:00.000Z`), 60), "yyyy-MM-dd");
  }

  const rangeStartIso = fromZonedTime(`${fromYmd}T00:00:00`, tz).toISOString();
  const rangeEndIso = fromZonedTime(`${toYmd}T23:59:59.999`, tz).toISOString();

  const statusFilter = includeCancelled
    ? { $in: ["confirmed", "cancelled", "pending"] }
    : { $in: ["confirmed", "pending"] };

  const variants = phoneQueryVariants(normalizedInput);

  let docs = await Booking.find({
    businessId: bizId,
    "customer.phone": { $in: variants },
    status: statusFilter,
    "slot.start": { $gte: rangeStartIso, $lte: rangeEndIso }
  })
    .sort({ "slot.start": 1 })
    .limit(limit)
    .lean();

  docs = docs.filter((b) => normalizePhoneForLookupMatch(b.customer?.phone) === normalizedInput);

  console.log("[booking-lookup]", {
    businessId: bizId,
    phoneHashed: hashPhoneForLog(normalizedInput),
    count: docs.length,
    dateRange: [fromYmd, toYmd]
  });

  const serviceCache = new Map();
  async function getService(bId, svcId) {
    const key = `${bId}::${svcId}`;
    if (serviceCache.has(key)) return serviceCache.get(key);
    const s = await Service.findOne({ businessId: bId, serviceId: svcId }).lean();
    serviceCache.set(key, s);
    return s;
  }

  const origin = (process.env.BOOK8_PUBLIC_ORIGIN || "https://book8.io").replace(/\/$/, "");

  const bookings = [];
  for (const b of docs) {
    const svc = await getService(b.businessId, b.serviceId);
    const d = new Date(b.slot?.start);
    if (Number.isNaN(d.getTime())) continue;

    const duration =
      svc?.durationMinutes != null ? svc.durationMinutes : slotDurationMinutes(b.slot);

    bookings.push({
      bookingId: b.id,
      serviceName: svc?.name || b.serviceId,
      serviceDurationMinutes: duration,
      slotStart: formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      slotLocalTime: formatInTimeZone(d, tz, "h:mm a"),
      slotLocalDate: formatInTimeZone(d, tz, "EEEE, MMMM d"),
      customerName: b.customer?.name ?? null,
      customerEmail: b.customer?.email ?? null,
      status: b.status,
      rescheduleUrl: `${origin}/manage/${b.id}`
    });
  }

  return {
    ok: true,
    count: bookings.length,
    bookings
  };
}

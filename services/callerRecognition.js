/**
 * BOO-MEM-1A: per-business returning-caller context for ElevenLabs conversation-init.
 * Privacy: lookups are strictly scoped to businessId.
 */
import { DateTime } from "luxon";
import { Booking } from "../models/Booking.js";
import { Service } from "../models/Service.js";
import { maskEmail } from "../src/utils/maskEmail.js";
import { normalizePhoneNumber } from "../src/utils/businessRouteHelpers.js";
import { normalizePhoneForLookupMatch } from "./bookingService.js";

const STRANGER = {
  caller_known: false,
  caller_name: null,
  caller_email_masked: null,
  last_booking_date: null,
  last_service_name: null
};

/** Match bookingService phoneQueryVariants for index-friendly $in queries. */
function phoneQueryVariants(e164) {
  const set = new Set([e164]);
  if (e164.startsWith("+")) set.add(e164.slice(1));
  return [...set];
}

const STATUS_RECOGNIZED = ["confirmed", "cancelled", "completed"];

/**
 * Look up the most recent booking (by slot.start) for this caller in this business.
 *
 * @param {string} businessId
 * @param {string} callerPhone
 * @param {{ timezone?: string, maxAgeDays?: number }} [options]
 * @returns {Promise<{
 *   caller_known: boolean,
 *   caller_name: string|null,
 *   caller_email_masked: string|null,
 *   last_booking_date: string|null,
 *   last_service_name: string|null
 * }>}
 */
export async function lookupCallerContext(
  businessId,
  callerPhone,
  { timezone = "America/Toronto", maxAgeDays = 365 } = {}
) {
  if (!businessId || !callerPhone || typeof businessId !== "string" || typeof callerPhone !== "string") {
    return { ...STRANGER };
  }

  const normalized = normalizePhoneNumber(callerPhone.trim());
  if (!normalized) {
    return { ...STRANGER };
  }

  const cutoff = DateTime.utc().minus({ days: maxAgeDays }).toJSDate();
  const cutoffIso = cutoff.toISOString();

  const variants = phoneQueryVariants(normalized);

  let docs = await Booking.find({
    businessId: businessId.trim(),
    "customer.phone": { $in: variants },
    status: { $in: STATUS_RECOGNIZED },
    "slot.start": { $gte: cutoffIso }
  })
    .sort({ "slot.start": -1 })
    .limit(25)
    .lean();

  docs = docs.filter((b) => normalizePhoneForLookupMatch(b.customer?.phone) === normalized);
  const lastBooking = docs[0];
  if (!lastBooking) {
    return { ...STRANGER };
  }

  let lastServiceName = null;
  try {
    if (lastBooking.serviceId) {
      const svc = await Service.findOne({
        businessId: businessId.trim(),
        serviceId: lastBooking.serviceId
      })
        .select("name")
        .lean();
      lastServiceName = svc?.name || null;
    }
  } catch {
    lastServiceName = null;
  }

  const slotStart = lastBooking.slot?.start;
  let lastYmd = null;
  if (slotStart) {
    const z = timezone && String(timezone).trim() ? String(timezone).trim() : "America/Toronto";
    lastYmd = DateTime.fromJSDate(new Date(slotStart), { zone: "utc" }).setZone(z).toFormat("yyyy-MM-dd");
  }

  return {
    caller_known: true,
    caller_name: lastBooking.customer?.name || null,
    caller_email_masked: maskEmail(lastBooking.customer?.email),
    last_booking_date: lastYmd,
    last_service_name: lastServiceName
  };
}

/**
 * ElevenLabs dynamic variables: all string values, empty when unknown.
 * @param {Awaited<ReturnType<typeof lookupCallerContext>>} ctx
 * @returns {Record<string, string>}
 */
export function callerContextToDynamicVariables(ctx) {
  if (!ctx || !ctx.caller_known) {
    return {
      caller_known: "false",
      caller_name: "",
      caller_email_masked: "",
      last_booking_date: "",
      last_service_name: ""
    };
  }
  return {
    caller_known: "true",
    caller_name: ctx.caller_name || "",
    caller_email_masked: ctx.caller_email_masked || "",
    last_booking_date: ctx.last_booking_date || "",
    last_service_name: ctx.last_service_name || ""
  };
}

export function emptyCallerDynamicVariables() {
  return callerContextToDynamicVariables({ ...STRANGER });
}

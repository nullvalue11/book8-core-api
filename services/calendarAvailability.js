/**
 * Calendar availability service.
 * TODO: Plug in real calendar provider (Google Calendar, Cal.com, etc.) when connected.
 * For now returns stub slots so the voice/booking flow can run end-to-end.
 */

import { Business } from "../models/Business.js";
import { formatSlotDisplay } from "./slotDisplay.js";

/**
 * Get available appointment slots for a business/service in a date range.
 * Uses business's calendar provider if configured; otherwise stub.
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.serviceId
 * @param {string} params.from - ISO 8601
 * @param {string} params.to - ISO 8601
 * @param {string} params.timezone - IANA
 * @param {number} params.durationMinutes
 * @returns {Promise<{ ok: boolean, error?: string, businessId?: string, serviceId?: string, timezone?: string, slots?: Array<{ start: string, end: string, display: string }> }>}
 */
export async function getAvailability(params) {
  const { businessId, serviceId, from, to, timezone, durationMinutes } = params;

  const business = await Business.findOne({ id: businessId }).lean();
  if (!business) {
    return { ok: false, error: "Business not found" };
  }

  const tz = timezone || business.timezone || "America/Toronto";
  const duration = Number(durationMinutes) || 60;

  // TODO: When calendar integration is available, call provider here using business.calendarProvider / business.calendarCredentials.
  // if (business.calendarProvider === 'google') { return await googleCalendar.getSlots(...); }
  const slots = await getStubSlots({ from, to, timezone: tz, durationMinutes: duration });

  return {
    ok: true,
    businessId,
    serviceId,
    timezone: tz,
    slots
  };
}

/**
 * Stub: generate a few sample slots in the requested range for development/voice flow.
 * Replace with real calendar provider fetch when integration is ready.
 */
async function getStubSlots({ from, to, timezone, durationMinutes }) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return [];
  }

  const slots = [];
  const durationMs = durationMinutes * 60 * 1000;
  const pad = (n) => String(n).padStart(2, "0");

  // Walk day-by-day in the request's local date range; add 2 PM and 4 PM slots each day
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);

  while (cursor < endDate && slots.length < 20) {
    const year = cursor.getFullYear();
    const month = pad(cursor.getMonth() + 1);
    const day = pad(cursor.getDate());
    for (const hour of [14, 16]) {
      const slotStart = new Date(`${year}-${month}-${day}T${pad(hour)}:00:00`);
      const slotEnd = new Date(slotStart.getTime() + durationMs);
      if (slotStart >= start && slotEnd <= end) {
        const offset = getOffsetForTimezone(slotStart, timezone);
        const slotStartStr = `${year}-${month}-${day}T${pad(hour)}:00:00${offset}`;
        const endHour = slotEnd.getHours();
        const endMin = slotEnd.getMinutes();
        const slotEndStr = `${year}-${month}-${day}T${pad(endHour)}:${pad(endMin)}:00${offset}`;
        slots.push({
          start: slotStartStr,
          end: slotEndStr,
          display: formatSlotDisplay(slotStartStr, timezone)
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}

function getOffsetForTimezone(date, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      timeZoneName: "shortOffset"
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    const value = tzPart?.value || "";
    const match = value.replace("GMT", "").trim().match(/([+-])(\d{1,2}):?(\d{2})?/);
    if (match) {
      const sign = match[1];
      const h = match[2].padStart(2, "0");
      const m = (match[3] || "00").padStart(2, "0");
      return `${sign}${h}:${m}`;
    }
  } catch (_) {}
  return "-05:00";
}

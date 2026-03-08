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
  const scheduleTz = business.weeklySchedule?.timezone || tz;
  const weeklyHours = business.weeklySchedule?.weeklyHours;
  const slots = weeklyHours && typeof weeklyHours === "object"
    ? getSlotsFromWeeklySchedule({ from, to, timezone: scheduleTz, durationMinutes: duration, weeklyHours })
    : await getStubSlots({ from, to, timezone: tz, durationMinutes: duration });

  return {
    ok: true,
    businessId,
    serviceId,
    timezone: tz,
    slots
  };
}

function getLocalDatePartsInTz(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long"
  });
  const parts = formatter.formatToParts(date);
  const get = (name) => parts.find((p) => p.type === name)?.value || "";
  const weekday = get("weekday").toLowerCase();
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday
  };
}

/**
 * Generate slots from business weekly schedule (e.g. Mon–Fri 09:00–17:00).
 */
function getSlotsFromWeeklySchedule({ from, to, timezone, durationMinutes, weeklyHours }) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return [];
  }

  const slots = [];
  const pad = (n) => String(n).padStart(2, "0");
  const seen = new Set();
  let cursor = new Date(start);

  while (cursor < end && slots.length < 50) {
    const { year, month, day, weekday } = getLocalDatePartsInTz(cursor, timezone);
    const key = `${year}-${month}-${day}`;
    if (!seen.has(key)) {
      seen.add(key);
      const blocks = weeklyHours[weekday];
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          const [startH = 0, startM = 0] = (block.start || "").split(":").map(Number);
          const [endH = 17, endM = 0] = (block.end || "").split(":").map(Number);
          const startMinutes = startH * 60 + startM;
          const endMinutes = endH * 60 + endM;
          for (let m = startMinutes; m + durationMinutes <= endMinutes; m += durationMinutes) {
            const h = Math.floor(m / 60);
            const min = m % 60;
            const slotStartStr = `${year}-${month}-${day}T${pad(h)}:${pad(min)}:00`;
            const slotStart = new Date(slotStartStr);
            if (Number.isNaN(slotStart.getTime())) continue;
            const offset = getOffsetForTimezone(slotStart, timezone);
            const slotStartIso = `${year}-${month}-${day}T${pad(h)}:${pad(min)}:00${offset}`;
            const endMin = m + durationMinutes;
            const endH2 = Math.floor(endMin / 60);
            const endMin2 = endMin % 60;
            const slotEndIso = `${year}-${month}-${day}T${pad(endH2)}:${pad(endMin2)}:00${offset}`;
            const slotStartDate = new Date(slotStartIso);
            const slotEndDate = new Date(slotEndIso);
            if (!Number.isNaN(slotStartDate.getTime()) && !Number.isNaN(slotEndDate.getTime()) && slotStartDate >= start && slotEndDate <= end) {
              slots.push({
                start: slotStartIso,
                end: slotEndIso,
                display: formatSlotDisplay(slotStartIso, timezone)
              });
            }
          }
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
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

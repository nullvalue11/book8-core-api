// BOO-60A: pure helpers for recurring bookings (no heavy imports)
import { randomBytes } from "crypto";
import { getPlanFeatures } from "../src/config/plans.js";
import { isFeatureAllowed } from "./planLimits.js";

export function generateSeriesId() {
  const suffix = randomBytes(9).toString("base64url").replace(/[-_]/g, "X").slice(0, 12);
  return `series_${suffix}`;
}

/**
 * @param {string} isoStart
 * @param {'weekly'|'biweekly'|'monthly'|'custom'} frequency
 * @param {number} [intervalDays]
 * @returns {string} ISO
 */
export function computeNextSlotStartIso(isoStart, frequency, intervalDays) {
  const d = new Date(isoStart);
  if (Number.isNaN(d.getTime())) return null;
  if (frequency === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7);
  } else if (frequency === "biweekly") {
    d.setUTCDate(d.getUTCDate() + 14);
  } else if (frequency === "monthly") {
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 1);
    if (d.getUTCDate() !== day) {
      d.setUTCDate(0);
    }
  } else if (frequency === "custom") {
    const n = Number(intervalDays);
    if (!Number.isFinite(n) || n < 1) return null;
    d.setUTCDate(d.getUTCDate() + Math.floor(n));
  } else {
    return null;
  }
  return d.toISOString();
}

/** YYYY-MM-DD in IANA timezone */
export function calendarDateYmd(isoStart, timezone) {
  const d = new Date(isoStart);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  } catch {
    return isoStart.slice(0, 10);
  }
}

/**
 * @param {object} params
 * @returns {{ ok: true, recurring: object } | { ok: false, error: string }}
 */
export function validateAndBuildRecurringMeta({
  plan,
  recurring,
  normStartIso,
  timezone,
  serviceDurationMinutes
}) {
  if (!recurring || !recurring.enabled) {
    return { ok: false, error: "recurring.enabled is required for recurring bookings" };
  }
  if (!isFeatureAllowed(plan || "starter", "recurringBookings")) {
    return {
      ok: false,
      error: "Recurring bookings are not available on your plan.",
      code: "PLAN",
      upgrade: true,
      requiredPlan: "growth"
    };
  }

  const frequency = recurring.frequency;
  if (!["weekly", "biweekly", "monthly", "custom"].includes(frequency)) {
    return { ok: false, error: "recurring.frequency must be weekly, biweekly, monthly, or custom" };
  }
  if (frequency === "custom") {
    const n = Number(recurring.intervalDays);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      return { ok: false, error: "recurring.intervalDays must be an integer between 1 and 365" };
    }
  }

  let total = Number(recurring.totalOccurrences);
  if (!Number.isInteger(total) || total < 2) {
    return { ok: false, error: "recurring.totalOccurrences must be an integer >= 2" };
  }

  const max = getPlanFeatures(plan).maxRecurringOccurrencesPerSeries ?? 0;
  if (max !== -1 && total > max) {
    return {
      ok: false,
      error: `recurring.totalOccurrences cannot exceed ${max} on your plan.`
    };
  }

  const intervalDays = frequency === "custom" ? Number(recurring.intervalDays) : undefined;
  const nextSlotStart = computeNextSlotStartIso(normStartIso, frequency, intervalDays);
  if (!nextSlotStart) {
    return { ok: false, error: "Could not compute next occurrence" };
  }

  const nextEnd = new Date(
    new Date(nextSlotStart).getTime() + (serviceDurationMinutes || 60) * 60000
  ).toISOString();

  const seriesId = generateSeriesId();
  const nextBookingDate = calendarDateYmd(nextSlotStart, timezone);

  const recurringDoc = {
    enabled: true,
    frequency,
    intervalDays: frequency === "custom" ? intervalDays : undefined,
    seriesId,
    occurrenceNumber: 1,
    totalOccurrences: total,
    nextBookingDate,
    nextSlotStart,
    autoRenew: recurring.autoRenew !== false,
    endDate: typeof recurring.endDate === "string" ? recurring.endDate : undefined,
    cancelledFromSeries: false
  };

  return { ok: true, recurring: recurringDoc, nextSlotStart, nextEnd };
}

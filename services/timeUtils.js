/**
 * BOO-107A: parse naïve wall-clock ISO strings in a business IANA timezone, store real UTC instants.
 */
import { DateTime } from "luxon";

const HAS_TZ_DESIGNATOR = /[Zz]|[+-]\d{2}:?\d{2}$/;

/**
 * Parse a naïve ISO datetime string in the given timezone and return a JS Date (UTC instant).
 *
 * @param {string} naiveIso - e.g. "2026-04-22T11:00:00" (no Z, no offset)
 * @param {string} timezone - IANA timezone e.g. "America/Toronto"
 * @returns {Date}
 */
export function parseSlotInTimezone(naiveIso, timezone) {
  if (typeof naiveIso !== "string") {
    throw new TypeError(`parseSlotInTimezone: expected string, got ${typeof naiveIso}`);
  }
  const trimmed = naiveIso.trim();
  if (HAS_TZ_DESIGNATOR.test(trimmed)) {
    throw new Error(
      `parseSlotInTimezone: input "${trimmed}" already has timezone designator; pass naïve ISO only`
    );
  }
  if (!timezone || !String(timezone).trim()) {
    throw new Error("parseSlotInTimezone: timezone is required");
  }
  const dt = DateTime.fromISO(trimmed, { zone: String(timezone).trim() });
  if (!dt.isValid) {
    throw new Error(
      `parseSlotInTimezone: invalid ISO "${trimmed}" in zone "${timezone}": ${dt.invalidReason || "unknown"}`
    );
  }
  return dt.toUTC().toJSDate();
}

/**
 * For HTTP handlers: naïve wall time → UTC Date using `timezone`; strings that already include
 * Z or a numeric offset are parsed as absolute instants via `Date` (unchanged semantics).
 *
 * @param {string|Date} raw
 * @param {string} timezone - IANA timezone when `raw` is naïve
 * @returns {Date}
 */
export function parseSlotInstantForStorage(raw, timezone) {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new Error("parseSlotInstantForStorage: invalid Date");
    }
    return raw;
  }
  if (typeof raw !== "string") {
    throw new TypeError(`parseSlotInstantForStorage: expected string or Date, got ${typeof raw}`);
  }
  const s = raw.trim();
  if (!s) {
    throw new Error("parseSlotInstantForStorage: empty slot time");
  }
  if (HAS_TZ_DESIGNATOR.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`parseSlotInstantForStorage: invalid absolute datetime "${s}"`);
    }
    return d;
  }
  return parseSlotInTimezone(s, timezone);
}

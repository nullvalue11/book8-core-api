/**
 * Calendar date YYYY-MM-DD for a slot start in the given IANA timezone.
 * @param {string} isoStart
 * @param {string} [timezone]
 * @returns {string|null}
 */
export function calendarDateFromSlotStart(isoStart, timezone) {
  const d = new Date(isoStart);
  if (Number.isNaN(d.getTime())) return null;
  const tz = timezone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

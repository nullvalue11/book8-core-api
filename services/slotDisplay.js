/**
 * Human-friendly display string for a slot (e.g. "Sunday at 2:00 PM").
 * Uses timezone for correct day/time.
 * @param {string} isoStart - ISO 8601 start time
 * @param {string} [timezone] - IANA timezone (e.g. America/Toronto)
 * @returns {string}
 */
export function formatSlotDisplay(isoStart, timezone = "America/Toronto") {
  try {
    const date = new Date(isoStart);
    if (Number.isNaN(date.getTime())) return isoStart;
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    return formatter.format(date);
  } catch {
    return isoStart;
  }
}

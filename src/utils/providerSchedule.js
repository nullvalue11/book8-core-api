/**
 * BOO-44A: convert Provider.schedule.weeklyHours (open/close/isOpen) to Schedule-style blocks.
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export function providerWeeklyHoursToBlocks(weeklyHours) {
  if (!weeklyHours || typeof weeklyHours !== "object") return null;
  const out = {};
  let any = false;
  for (const day of DAYS) {
    const d = weeklyHours[day];
    if (d && d.isOpen && d.open && d.close) {
      out[day] = [{ start: String(d.open).trim(), end: String(d.close).trim() }];
      any = true;
    } else {
      out[day] = [];
    }
  }
  return any ? out : null;
}

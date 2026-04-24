/**
 * BOO-117: normalize calendar fields POSTed from book8-ai for Business updates.
 */

export function normalizeCalendarProviderValue(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase();
  if (s === "outlook") return "microsoft";
  if (s === "google" || s === "microsoft") return s;
  return null;
}

function parseIsoOrNull(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Flat $set keys for Mongoose Business update (calendar.* + optional calendarProvider).
 * Only keys explicitly present on `calendar` are applied (partial PATCH semantics).
 *
 * @param {{ calendar?: object, calendarProvider?: unknown }} body
 * @returns {Record<string, unknown>}
 */
export function buildCalendarSyncUpdate(body) {
  const { calendar, calendarProvider } = body || {};
  const $set = {};

  if (calendarProvider !== undefined) {
    $set.calendarProvider = normalizeCalendarProviderValue(calendarProvider);
  }

  if (calendar != null && typeof calendar === "object" && !Array.isArray(calendar)) {
    const c = calendar;
    if (c.connected !== undefined) {
      $set["calendar.connected"] = !!c.connected;
    }
    if (c.provider !== undefined) {
      $set["calendar.provider"] = normalizeCalendarProviderValue(c.provider);
    }
    if (c.connectedAt !== undefined) {
      $set["calendar.connectedAt"] = parseIsoOrNull(c.connectedAt);
    }
    if (c.calendarId !== undefined) {
      $set["calendar.calendarId"] =
        c.calendarId == null || c.calendarId === "" ? null : String(c.calendarId).slice(0, 512);
    }
    if (c.lastSyncedAt !== undefined) {
      $set["calendar.lastSyncedAt"] = parseIsoOrNull(c.lastSyncedAt);
    }
  }

  const touchedNested = Object.keys($set).some((k) => k.startsWith("calendar."));
  const touchedTop = Object.prototype.hasOwnProperty.call($set, "calendarProvider");
  if (touchedNested || touchedTop) {
    $set["calendar.updatedAt"] = new Date();
  }

  return $set;
}

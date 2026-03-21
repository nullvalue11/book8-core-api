/**
 * Calendar service for book8-ai provider routing.
 * - Google provider: gcal-busy, gcal-create-event, gcal-delete-event, gcal-update-event
 * - Microsoft provider: outlook-busy, outlook-create-event, outlook-delete-event, outlook-update-event
 *
 * Used to filter availability slots and to sync create/delete bookings.
 * On failure or timeout, returns null (graceful degradation).
 */

const BOOK8_AI_URL = process.env.BOOK8_AI_URL || "https://www.book8.io";
const GCAL_BUSY_TIMEOUT_MS = 3000;

function normalizeProvider(calendarProvider) {
  return calendarProvider === "microsoft" ? "microsoft" : "google";
}

/**
 * Effective provider for routing: prefer nested book8-ai `calendar.provider`, then top-level `calendarProvider`.
 * @param {object} business - lean Business doc
 * @returns {"google"|"microsoft"|undefined}
 */
export function resolveCalendarProviderForBusiness(business) {
  if (!business) return undefined;
  const nested = business.calendar?.provider;
  if (nested === "microsoft" || nested === "google") return nested;
  const top = business.calendarProvider;
  if (top === "microsoft" || top === "google") return top;
  return undefined;
}

function getCalendarEndpoints(calendarProvider) {
  const provider = normalizeProvider(calendarProvider);
  if (provider === "microsoft") {
    return {
      busy: "/api/internal/outlook-busy",
      create: "/api/internal/outlook-create-event",
      delete: "/api/internal/outlook-delete-event",
      update: "/api/internal/outlook-update-event"
    };
  }

  return {
    busy: "/api/internal/gcal-busy",
    create: "/api/internal/gcal-create-event",
    delete: "/api/internal/gcal-delete-event",
    update: "/api/internal/gcal-update-event"
  };
}

/**
 * Call book8-ai POST (provider busy) and return busy periods, or null on failure.
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.from - ISO date range start
 * @param {string} params.to - ISO date range end
 * @param {string} params.timezone
 * @param {"google"|"microsoft"} params.calendarProvider
 * @returns {Promise<Array<{ start: string, end: string }> | null>}
 */
export async function getGcalBusyPeriods({ businessId, from, to, timezone, calendarProvider }) {
  // Prevent provider network calls during test runs (avoids open handle issues).
  if (process.env.NODE_ENV === "test") return null;

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return null;
  }

  const endpoints = getCalendarEndpoints(calendarProvider);
  const url = `${BOOK8_AI_URL.replace(/\/$/, "")}${endpoints.busy}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GCAL_BUSY_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-book8-internal-secret": secret
      },
      body: JSON.stringify({ businessId, from, to, timezone }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn("[gcalService] calendar busy non-200:", res.status, res.statusText);
      return null;
    }

    const data = await res.json();
    const busy = data?.busy ?? data?.periods;
    if (!Array.isArray(busy)) {
      return null;
    }
    return busy.filter((p) => p && typeof p.start === "string" && typeof p.end === "string");
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      console.warn("[gcalService] calendar busy timeout after", GCAL_BUSY_TIMEOUT_MS, "ms");
    } else {
      console.warn("[gcalService] calendar busy error:", err.message);
    }
    return null;
  }
}

/**
 * Create a calendar event via book8-ai's provider-specific create endpoint.
 * Fire-and-forget; logs and returns null on failure.
 */
export async function createGcalEvent({
  businessId,
  bookingId,
  title,
  description,
  start,
  end,
  timezone,
  customer,
  calendarProvider
}) {
  // Prevent provider network calls during test runs (avoids open handle issues).
  if (process.env.NODE_ENV === "test") return null;

  const BOOK8_AI_URL = process.env.BOOK8_AI_URL || "https://www.book8.io";
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret) {
    console.warn("[gcalService] INTERNAL_API_SECRET not set — skipping calendar sync");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const endpoints = getCalendarEndpoints(calendarProvider);
  try {
    const response = await fetch(`${BOOK8_AI_URL.replace(/\/$/, "")}${endpoints.create}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-book8-internal-secret": secret
      },
      body: JSON.stringify({ businessId, bookingId, title, description, start, end, timezone, customer }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn("[gcalService] Calendar create returned:", response.status);
      return null;
    }

    const data = await response.json();
    // "skipped" in old logs was `data.eventId || "skipped"` — book8-ai often returns 200 with no eventId + reason.
    if (data?.eventId) {
      console.log("[gcalService] Calendar event created:", data.eventId, data.reason || "");
    } else {
      console.log(
        "[gcalService] Calendar create: book8-ai returned no eventId (not a core-api skip before fetch). reason:",
        data?.reason || data?.message || "(none)",
        "raw:",
        typeof data === "object" ? JSON.stringify(data) : data
      );
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    console.warn("[gcalService] GCal create event failed:", err.message);
    return null;
  }
}

/**
 * Delete a calendar event via book8-ai's provider-specific delete endpoint.
 * Used when a booking is cancelled.
 */
export async function deleteGcalEvent({ businessId, bookingId, calendarProvider }) {
  // Prevent provider network calls during test runs (avoids open handle issues).
  if (process.env.NODE_ENV === "test") return null;

  const BOOK8_AI_URL = process.env.BOOK8_AI_URL || "https://www.book8.io";
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret) return null;

  try {
    const endpoints = getCalendarEndpoints(calendarProvider);
    const response = await fetch(`${BOOK8_AI_URL.replace(/\/$/, "")}${endpoints.delete}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-book8-internal-secret": secret
      },
      body: JSON.stringify({ businessId, bookingId })
    });

    const data = await response.json();
    console.log("[gcalService] Calendar event deleted:", data);
    return data;
  } catch (err) {
    console.warn("[gcalService] GCal delete event failed:", err.message);
    return null;
  }
}

/**
 * Update a calendar event (e.g. mark cancelled, show as free) via book8-ai.
 * On non-OK response or network error, falls back to delete if bookingId is provided.
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.eventId - provider calendar event id (stored as booking.calendarEventId)
 * @param {string} [params.bookingId] - for fallback delete
 * @param {"google"|"microsoft"} params.calendarProvider
 * @param {{ title?: string, showAs?: string }} [params.updates]
 */
export async function updateGcalEvent({
  businessId,
  eventId,
  bookingId,
  calendarProvider,
  updates = {}
}) {
  if (process.env.NODE_ENV === "test") return null;

  const BOOK8_AI_URL = process.env.BOOK8_AI_URL || "https://www.book8.io";
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret || !eventId) {
    console.warn("[gcalService] Missing secret or eventId — skipping calendar update");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const endpoints = getCalendarEndpoints(calendarProvider);
  const url = `${BOOK8_AI_URL.replace(/\/$/, "")}${endpoints.update}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-book8-internal-secret": secret
      },
      body: JSON.stringify({ businessId, eventId, ...updates }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn("[gcalService] Calendar update returned:", response.status);
      console.log("[gcalService] Falling back to delete");
      if (bookingId) {
        await deleteGcalEvent({ businessId, bookingId, calendarProvider });
      }
      return null;
    }

    const data = await response.json();
    console.log("[gcalService] Calendar event updated:", data);
    return data;
  } catch (err) {
    clearTimeout(timeout);
    console.warn("[gcalService] Calendar update failed:", err.message);
    if (bookingId) {
      try {
        await deleteGcalEvent({ businessId, bookingId, calendarProvider });
      } catch (delErr) {
        console.warn("[gcalService] Fallback delete also failed:", delErr.message);
      }
    }
    return null;
  }
}

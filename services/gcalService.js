/**
 * Fetch Google Calendar busy periods from book8-ai's gcal-busy endpoint.
 * Used to filter availability slots. On failure or timeout, returns null (graceful degradation).
 */

const BOOK8_AI_URL = process.env.BOOK8_AI_URL || "https://www.book8.io";
const GCAL_BUSY_TIMEOUT_MS = 3000;

/**
 * Call book8-ai POST /api/internal/gcal-busy and return busy periods, or null on failure.
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.from - ISO date range start
 * @param {string} params.to - ISO date range end
 * @param {string} params.timezone
 * @returns {Promise<Array<{ start: string, end: string }> | null>}
 */
export async function getGcalBusyPeriods({ businessId, from, to, timezone }) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return null;
  }

  const url = `${BOOK8_AI_URL.replace(/\/$/, "")}/api/internal/gcal-busy`;
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
      console.warn("[gcalService] gcal-busy non-200:", res.status, res.statusText);
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
      console.warn("[gcalService] gcal-busy timeout after", GCAL_BUSY_TIMEOUT_MS, "ms");
    } else {
      console.warn("[gcalService] gcal-busy error:", err.message);
    }
    return null;
  }
}

/**
 * Create a Google Calendar event via book8-ai's gcal-create-event endpoint.
 * Fire-and-forget; logs and returns null on failure.
 */
export async function createGcalEvent({ businessId, bookingId, title, description, start, end, timezone, customer }) {
  const BOOK8_AI_URL = process.env.BOOK8_AI_URL || "https://www.book8.io";
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret) {
    console.warn("[gcalService] INTERNAL_API_SECRET not set — skipping calendar sync");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${BOOK8_AI_URL.replace(/\/$/, "")}/api/internal/gcal-create-event`, {
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
      console.warn("[gcalService] GCal create event returned:", response.status);
      return null;
    }

    const data = await response.json();
    console.log("[gcalService] Calendar event created:", data.eventId || "skipped", data.reason || "");
    return data;
  } catch (err) {
    clearTimeout(timeout);
    console.warn("[gcalService] GCal create event failed:", err.message);
    return null;
  }
}

/**
 * Delete a Google Calendar event via book8-ai's gcal-delete-event endpoint.
 * Used when a booking is cancelled.
 */
export async function deleteGcalEvent({ businessId, bookingId }) {
  const BOOK8_AI_URL = process.env.BOOK8_AI_URL || "https://www.book8.io";
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret) return null;

  try {
    const response = await fetch(`${BOOK8_AI_URL.replace(/\/$/, "")}/api/internal/gcal-delete-event`, {
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

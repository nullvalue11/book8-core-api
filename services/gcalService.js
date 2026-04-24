import {
  getFreebusyCached,
  setFreebusyCached
} from "../src/services/gcalBusyCache.js";
import { truncateErr } from "./gcalSyncHelpers.js";

/**
 * Calendar service for book8-ai provider routing.
 * BOO-102A: create/update/delete/patch never throw; JSON/HTML bodies parsed safely.
 * BOO-107A: booking.slot.start / end must already be true UTC ISO strings from bookingService;
 *   `timezone` is the IANA zone for provider APIs — no extra parsing here.
 */

const BOOK8_AI_URL = process.env.BOOK8_AI_URL || "https://www.book8.io";
const GCAL_BUSY_TIMEOUT_MS = 3000;

function shouldSkipGcalHttp() {
  return process.env.NODE_ENV === "test" && process.env.GCAL_INTEGRATION_TEST !== "1";
}

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
 * @param {unknown} err
 * @param {number} [responseStatus]
 * @param {string} [bodyText]
 * @returns {"token_expired"|"not_found"|"rate_limited"|"network"|"unknown"}
 */
export function classifyGcalError(err, responseStatus, bodyText = "") {
  const t = (bodyText || "").trim();
  const tLower = t.slice(0, 512).toLowerCase();
  if (tLower.startsWith("<!doctype") || tLower.startsWith("<html")) {
    return "token_expired";
  }

  const st = typeof responseStatus === "number" ? responseStatus : 0;
  if (st === 404) return "not_found";
  if (st === 429) return "rate_limited";
  if (st === 401 || st === 403) return "token_expired";

  const code = err?.code;
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ENETUNREACH"].includes(code)) {
    return "network";
  }
  if (err?.name === "AbortError") return "network";
  const m = `${err?.message || ""} ${t}`.toLowerCase();
  if (m.includes("fetch failed") || m.includes("network") || m.includes("socket")) {
    return "network";
  }

  return "unknown";
}

async function readResponseBodySafe(response) {
  let text = "";
  try {
    text = await response.text();
  } catch (e) {
    return {
      text: "",
      parseError: true,
      data: null,
      readErr: e
    };
  }
  const trimmed = text.trim();
  const tLower = trimmed.slice(0, 16).toLowerCase();
  if (tLower.startsWith("<!doctype") || tLower.startsWith("<html")) {
    return { text, parseError: true, data: null, isHtml: true };
  }
  if (trimmed === "") {
    return { text, parseError: false, data: null };
  }
  try {
    return { text, parseError: false, data: JSON.parse(trimmed) };
  } catch {
    return { text, parseError: true, data: null };
  }
}

function summarizeFailureMessage(parsed, status) {
  const d = parsed?.data;
  const msg =
    (typeof d?.message === "string" && d.message) ||
    (typeof d?.error === "string" && d.error) ||
    (typeof d?.reason === "string" && d.reason) ||
    (parsed?.text && parsed.text.trim()) ||
    `HTTP ${status}`;
  return truncateErr(msg, 400);
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
  if (shouldSkipGcalHttp()) return null;

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    return null;
  }

  const cached = getFreebusyCached({ businessId, from, to, calendarProvider });
  if (cached) {
    return cached;
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

    const parsed = await readResponseBodySafe(res);
    if (parsed.parseError && !parsed.isHtml) {
      console.warn("[gcalService] calendar busy: non-JSON body");
      return null;
    }
    if (parsed.isHtml) {
      console.warn("[gcalService] calendar busy: HTML body (auth/token?)");
      return null;
    }

    const data = parsed.data;
    const busy = data?.busy ?? data?.periods;
    if (!Array.isArray(busy)) {
      return null;
    }
    const filtered = busy.filter((p) => p && typeof p.start === "string" && typeof p.end === "string");
    setFreebusyCached({ businessId, from, to, calendarProvider }, filtered);
    return filtered;
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
 * BOO-102A: always returns a result object; never throws.
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
  if (shouldSkipGcalHttp()) {
    return { ok: true, skipped: true };
  }

  const baseUrl = process.env.BOOK8_AI_URL || "https://www.book8.io";
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret) {
    console.warn("[gcalService] INTERNAL_API_SECRET not set — skipping calendar sync");
    return { ok: true, skipped: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const endpoints = getCalendarEndpoints(calendarProvider);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${endpoints.create}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-book8-internal-secret": secret
      },
      body: JSON.stringify({ businessId, bookingId, title, description, start, end, timezone, customer }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const parsed = await readResponseBodySafe(response);

    if (!response.ok) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = summarizeFailureMessage(parsed, response.status);
      console.warn("[gcalService] Calendar create returned:", response.status, errorType);
      return { ok: false, errorType, message };
    }

    if (parsed.parseError && parsed.isHtml) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = truncateErr(parsed.text, 400);
      console.warn("[gcalService] Calendar create: HTML response", errorType);
      return { ok: false, errorType, message };
    }

    if (parsed.parseError) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = summarizeFailureMessage(parsed, response.status);
      console.warn("[gcalService] Calendar create: invalid JSON body");
      return { ok: false, errorType, message };
    }

    const data = parsed.data || {};
    if (data?.eventId) {
      console.log("[gcalService] Calendar event created:", data.eventId, data.reason || "");
      return { ok: true, eventId: data.eventId };
    }
    console.log(
      "[gcalService] Calendar create: book8-ai returned no eventId. reason:",
      data?.reason || data?.message || "(none)"
    );
    return { ok: true, skipped: true };
  } catch (err) {
    clearTimeout(timeout);
    const errorType = classifyGcalError(err);
    const message = truncateErr(err?.message || String(err), 400);
    console.warn("[gcalService] GCal create event failed:", message);
    return { ok: false, errorType, message };
  }
}

/**
 * Delete a calendar event via book8-ai's provider-specific delete endpoint.
 * BOO-102A: structured result; never throws.
 * BOO-113-FIX: book8-ai expects { businessId, eventId } (booking.calendarEventId).
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {{ id?: string, calendarEventId?: string }} params.booking
 * @param {"google"|"microsoft"} params.calendarProvider
 */
export async function deleteGcalEvent({ businessId, booking, calendarProvider }) {
  if (shouldSkipGcalHttp()) {
    return { ok: true, skipped: true };
  }

  const baseUrl = process.env.BOOK8_AI_URL || "https://www.book8.io";
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret) {
    return { ok: true, skipped: true };
  }

  const eventId = booking?.calendarEventId;
  if (eventId == null || eventId === "") {
    console.log("[gcalService] No calendarEventId on booking — skipping delete.");
    return { ok: true, skipped: true };
  }

  try {
    const endpoints = getCalendarEndpoints(calendarProvider);
    const deleteUrl = `${baseUrl.replace(/\/$/, "")}${endpoints.delete}`;
    const response = await fetch(deleteUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-book8-internal-secret": secret
      },
      body: JSON.stringify({ businessId, eventId })
    });

    const parsed = await readResponseBodySafe(response);

    if (!response.ok) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = summarizeFailureMessage(parsed, response.status);
      console.warn("[gcalService] Calendar delete non-OK:", response.status, errorType);
      return { ok: false, errorType, message };
    }

    if (parsed.parseError && parsed.isHtml) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = truncateErr(parsed.text, 400);
      return { ok: false, errorType, message };
    }

    if (parsed.parseError) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = summarizeFailureMessage(parsed, response.status);
      console.warn("[gcalService] Calendar delete: invalid JSON body");
      return { ok: false, errorType, message };
    }

    console.log("[gcalService] Calendar event deleted:", parsed.data);
    return { ok: true };
  } catch (err) {
    const errorType = classifyGcalError(err);
    const message = truncateErr(err?.message || String(err), 400);
    console.warn("[gcalService] GCal delete event failed:", message);
    return { ok: false, errorType, message };
  }
}

/**
 * Update a calendar event (e.g. mark cancelled, show as free) via book8-ai.
 * BOO-102A: no thrown errors; optional delete fallback removed (non-blocking).
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.eventId - provider calendar event id (stored as booking.calendarEventId)
 * @param {string} [params.bookingId] - retained for API compatibility
 * @param {"google"|"microsoft"} params.calendarProvider
 * @param {{ title?: string, showAs?: string }} [params.updates]
 */
export async function updateGcalEvent({
  businessId,
  eventId,
  bookingId: _bookingId,
  calendarProvider,
  updates = {}
}) {
  if (shouldSkipGcalHttp()) {
    return { ok: true, skipped: true };
  }

  const baseUrl = process.env.BOOK8_AI_URL || "https://www.book8.io";
  const secret = process.env.INTERNAL_API_SECRET;

  if (!secret || !eventId) {
    console.warn("[gcalService] Missing secret or eventId — skipping calendar update");
    return { ok: true, skipped: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const endpoints = getCalendarEndpoints(calendarProvider);
  const url = `${baseUrl.replace(/\/$/, "")}${endpoints.update}`;

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

    const parsed = await readResponseBodySafe(response);

    if (!response.ok) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = summarizeFailureMessage(parsed, response.status);
      console.warn("[gcalService] Calendar update returned:", response.status, errorType);
      return { ok: false, errorType, message };
    }

    if (parsed.parseError && parsed.isHtml) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = truncateErr(parsed.text, 400);
      return { ok: false, errorType, message };
    }

    if (parsed.parseError) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = summarizeFailureMessage(parsed, response.status);
      console.warn("[gcalService] Calendar update: invalid JSON body");
      return { ok: false, errorType, message };
    }

    console.log("[gcalService] Calendar event updated:", parsed.data);
    return { ok: true };
  } catch (err) {
    clearTimeout(timeout);
    const errorType = classifyGcalError(err);
    const message = truncateErr(err?.message || String(err), 400);
    console.warn("[gcalService] Calendar update failed:", message);
    return { ok: false, errorType, message };
  }
}

/**
 * BOO-98A / BOO-102A: move calendar event to new start/end (book8-ai update endpoint).
 * Aliased as moveCalendarEvent for specs.
 */
export async function patchCalendarEventSchedule({
  businessId,
  eventId,
  calendarProvider,
  start,
  end,
  timezone
}) {
  if (shouldSkipGcalHttp()) {
    return { ok: true, skipped: true };
  }

  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || !eventId) {
    console.warn("[gcalService] patchCalendarEventSchedule: missing secret or eventId");
    return { ok: true, skipped: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const endpoints = getCalendarEndpoints(calendarProvider);
  const url = `${BOOK8_AI_URL.replace(/\/$/, "")}${endpoints.update}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-book8-internal-secret": secret
      },
      body: JSON.stringify({
        businessId,
        eventId,
        start,
        end,
        timezone,
        sendUpdates: "none"
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const parsed = await readResponseBodySafe(response);

    if (!response.ok) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = summarizeFailureMessage(parsed, response.status);
      console.warn("[gcalService] patchCalendarEventSchedule non-OK:", response.status, errorType);
      return { ok: false, errorType, message };
    }

    if (parsed.parseError && parsed.isHtml) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = truncateErr(parsed.text, 400);
      console.warn("[gcalService] patchCalendarEventSchedule: HTML body", errorType);
      return { ok: false, errorType, message };
    }

    if (parsed.parseError) {
      const errorType = classifyGcalError(null, response.status, parsed.text);
      const message = summarizeFailureMessage(parsed, response.status);
      console.warn("[gcalService] patchCalendarEventSchedule: invalid JSON body");
      return { ok: false, errorType, message };
    }

    const data = parsed.data || {};
    console.log("[gcalService] patchCalendarEventSchedule:", data?.eventId || "(ok)");
    return { ok: true, eventId: data?.eventId || eventId };
  } catch (err) {
    clearTimeout(timeout);
    const errorType = classifyGcalError(err);
    const message = truncateErr(err?.message || String(err), 400);
    console.warn("[gcalService] patchCalendarEventSchedule failed:", message);
    return { ok: false, errorType, message };
  }
}

/** BOO-102A: spec name for calendar move (same as patchCalendarEventSchedule). */
export const moveCalendarEvent = patchCalendarEventSchedule;

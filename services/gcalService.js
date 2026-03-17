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

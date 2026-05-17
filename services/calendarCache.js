/**
 * BOO-PERF-GCAL-CACHE-1A — In-memory LRU cache for Google Calendar busy times (per business + date + TZ).
 */

import { LRUCache } from "lru-cache";
import { formatInTimeZone } from "date-fns-tz";

const CACHE_ENABLED = process.env.CALENDAR_CACHE_ENABLED !== "false";
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 500;

const cache = new LRUCache({
  max: CACHE_MAX_SIZE,
  ttl: CACHE_TTL_MS
});

function buildKey(businessId, dateISO, timezone) {
  return `${businessId}::${dateISO}::${timezone}`;
}

/**
 * @param {string} slotStartIso
 * @param {string} timezone
 * @returns {string | null} YYYY-MM-DD in business timezone
 */
export function slotToDateISO(slotStartIso, timezone) {
  if (!slotStartIso) return null;
  const d = new Date(slotStartIso);
  if (Number.isNaN(d.getTime())) return null;
  const tz = timezone && String(timezone).trim() ? timezone : "UTC";
  return formatInTimeZone(d, tz, "yyyy-MM-dd");
}

export function getBusyTimes(businessId, dateISO, timezone) {
  if (!CACHE_ENABLED) return null;
  const entry = cache.get(buildKey(businessId, dateISO, timezone));
  return entry ? entry.busyTimes : null;
}

export function setBusyTimes(businessId, dateISO, timezone, busyTimes) {
  if (!CACHE_ENABLED) return;
  cache.set(buildKey(businessId, dateISO, timezone), {
    busyTimes: Array.isArray(busyTimes) ? busyTimes : [],
    cachedAt: Date.now()
  });
}

export function invalidateBusinessDate(businessId, dateISO) {
  if (!CACHE_ENABLED) return 0;
  const prefix = `${businessId}::${dateISO}::`;
  let deleted = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      deleted++;
    }
  }
  return deleted;
}

/**
 * Invalidate cache for a booking slot (all timezone keys for that calendar date).
 * @returns {number} entries removed
 */
export function invalidateCalendarCacheForSlot(businessId, slotStartIso, timezone, reason) {
  const dateISO = slotToDateISO(slotStartIso, timezone);
  if (!dateISO) return 0;
  const deleted = invalidateBusinessDate(businessId, dateISO);
  if (deleted > 0 && reason) {
    console.log(
      `[cache:invalidate] ${reason} businessId=${businessId} date=${dateISO} entries=${deleted}`
    );
  }
  return deleted;
}

export function stats() {
  return {
    enabled: CACHE_ENABLED,
    size: cache.size,
    max: CACHE_MAX_SIZE,
    ttlMs: CACHE_TTL_MS
  };
}

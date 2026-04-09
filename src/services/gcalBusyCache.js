/**
 * BOO-84A — Short TTL cache for Google/Outlook busy periods (via book8-ai proxy) to reduce quota + latency.
 */

const FREEBUSY_TTL_MS = 60 * 1000;
const freebusyCache = new Map();
const MAX_KEYS = 2000;

function cacheKey(parts) {
  return parts.join("|");
}

/**
 * @param {{ businessId: string, from: string, to: string, calendarProvider?: string }} p
 */
export function getFreebusyCached(p) {
  const key = cacheKey([
    p.businessId,
    String(p.from),
    String(p.to),
    String(p.calendarProvider || "google")
  ]);
  const row = freebusyCache.get(key);
  if (!row) return null;
  if (Date.now() - row.t > FREEBUSY_TTL_MS) {
    freebusyCache.delete(key);
    return null;
  }
  return row.data;
}

export function setFreebusyCached(p, data) {
  const key = cacheKey([
    p.businessId,
    String(p.from),
    String(p.to),
    String(p.calendarProvider || "google")
  ]);
  if (freebusyCache.size >= MAX_KEYS) {
    const first = freebusyCache.keys().next().value;
    if (first) freebusyCache.delete(first);
  }
  freebusyCache.set(key, { data, t: Date.now() });
}

/** After a booking is created, drop cached busy ranges for this business (next availability is fresh). */
export function invalidateFreebusyCacheForBusiness(businessId) {
  const prefix = `${String(businessId)}|`;
  for (const k of [...freebusyCache.keys()]) {
    if (k.startsWith(prefix)) freebusyCache.delete(k);
  }
}

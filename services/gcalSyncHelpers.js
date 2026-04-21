/**
 * BOO-102A: derive persisted gcalSync subdocument from a calendar API result.
 */

export function truncateErr(s, max = 500) {
  if (s == null || s === "") return "";
  const t = String(s);
  return t.length <= max ? t : t.slice(0, max);
}

/**
 * @param {object | null | undefined} prev
 * @param {{ ok?: boolean, skipped?: boolean, eventId?: string|null, errorType?: string, message?: string }} result
 * @param {"create"|"patch"|"update"|"delete"} op
 */
export function nextGcalSyncFromResult(prev, result, op) {
  const prevFc = typeof prev?.failureCount === "number" ? prev.failureCount : 0;
  const prevEid =
    prev?.eventId != null && prev.eventId !== "" ? String(prev.eventId).trim() : null;

  if (result?.skipped) {
    return {
      status: "skipped",
      eventId: result.eventId != null && result.eventId !== "" ? String(result.eventId) : prevEid,
      lastAttempt: new Date(),
      lastError: null,
      failureCount: prevFc
    };
  }

  if (result?.ok) {
    if (op === "delete") {
      return {
        status: "synced",
        eventId: null,
        lastAttempt: new Date(),
        lastError: null,
        failureCount: 0
      };
    }
    const eid =
      result.eventId != null && result.eventId !== ""
        ? String(result.eventId)
        : prevEid;
    return {
      status: "synced",
      eventId: eid,
      lastAttempt: new Date(),
      lastError: null,
      failureCount: 0
    };
  }

  return {
    status: "failed",
    eventId: prevEid,
    lastAttempt: new Date(),
    lastError: truncateErr(result?.message || "unknown", 500),
    failureCount: prevFc + 1
  };
}

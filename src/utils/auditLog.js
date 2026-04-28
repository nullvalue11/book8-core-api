/**
 * BOO-CANCEL-1A — minimal audit log helper for cancel-account / hard-delete flows.
 *
 * Writes structured events to the `ops_event_logs` collection on the active
 * mongoose connection (book8-core). Callers may optionally pass a custom
 * mongoose connection for cross-DB writes (e.g. book8 dashboard DB).
 *
 * Failure to write audit logs MUST NOT break the calling flow; we log and
 * swallow the error so cancel/hard-delete remain best-effort idempotent.
 */
import mongoose from "mongoose";

/** Recognized event types used by the cancel-account / hard-delete pipeline. */
export const AUDIT_EVENTS = Object.freeze({
  SUBSCRIPTION_CANCELLED: "subscription_cancelled",
  SUBSCRIPTION_RESTORED: "subscription_restored",
  BUSINESS_SOFT_DELETED: "business_soft_deleted",
  BUSINESS_HARD_DELETED: "business_hard_deleted",
  REFUND_ISSUED: "refund_issued",
  CANCELLATION_FAILED: "cancellation_failed"
});

const KNOWN_EVENT_VALUES = new Set(Object.values(AUDIT_EVENTS));

/**
 * Append a single audit-log entry. Never throws.
 *
 * @param {Object} input
 * @param {string} input.event Event type (recommended: one of AUDIT_EVENTS)
 * @param {string} [input.businessId] Business identifier (id or businessId)
 * @param {Object} [input.context] Arbitrary structured context (sanitized callers should
 *   avoid putting secrets here; this is persisted verbatim).
 * @param {Date}   [input.timestamp] Event timestamp (defaults to now)
 * @param {import('mongoose').Connection} [input.connection] Optional explicit connection;
 *   defaults to the default mongoose connection (book8-core).
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function writeAuditLog({
  event,
  businessId = null,
  context = null,
  timestamp = null,
  connection = null
} = {}) {
  if (!event || typeof event !== "string") {
    return { ok: false, error: "event_required" };
  }

  const conn = connection || mongoose.connection;
  if (!conn || !conn.db) {
    return { ok: false, error: "no_active_db_connection" };
  }

  const doc = {
    event,
    businessId: businessId ? String(businessId) : null,
    context: context && typeof context === "object" ? context : null,
    timestamp: timestamp instanceof Date ? timestamp : new Date(),
    createdAt: new Date()
  };

  if (!KNOWN_EVENT_VALUES.has(event)) {
    doc.context = { ...(doc.context || {}), _unknown_event: true };
  }

  try {
    await conn.db.collection("ops_event_logs").insertOne(doc);
    return { ok: true };
  } catch (err) {
    console.error(
      "[auditLog] failed to insert ops_event_logs entry:",
      err && err.message ? err.message : err
    );
    return { ok: false, error: err && err.message ? err.message : "insert_failed" };
  }
}

/**
 * Convenience wrappers — keep call sites short and grep-friendly.
 */
export const audit = {
  subscriptionCancelled: (businessId, context, opts = {}) =>
    writeAuditLog({
      event: AUDIT_EVENTS.SUBSCRIPTION_CANCELLED,
      businessId,
      context,
      ...opts
    }),
  subscriptionRestored: (businessId, context, opts = {}) =>
    writeAuditLog({
      event: AUDIT_EVENTS.SUBSCRIPTION_RESTORED,
      businessId,
      context,
      ...opts
    }),
  businessSoftDeleted: (businessId, context, opts = {}) =>
    writeAuditLog({
      event: AUDIT_EVENTS.BUSINESS_SOFT_DELETED,
      businessId,
      context,
      ...opts
    }),
  businessHardDeleted: (businessId, context, opts = {}) =>
    writeAuditLog({
      event: AUDIT_EVENTS.BUSINESS_HARD_DELETED,
      businessId,
      context,
      ...opts
    }),
  refundIssued: (businessId, context, opts = {}) =>
    writeAuditLog({
      event: AUDIT_EVENTS.REFUND_ISSUED,
      businessId,
      context,
      ...opts
    }),
  cancellationFailed: (businessId, context, opts = {}) =>
    writeAuditLog({
      event: AUDIT_EVENTS.CANCELLATION_FAILED,
      businessId,
      context,
      ...opts
    })
};

export default { writeAuditLog, audit, AUDIT_EVENTS };

/**
 * BOO-CANCEL-1A — businessHardDelete service
 *
 * Encapsulates the cascade-delete logic that previously only existed inside
 * one-off scripts (e.g. scripts/purgeBusinessByBusinessId.mjs and
 * scripts/purgeSignupByEmailFull.mjs). Reusable from:
 *   - the cron at /api/cron/hard-delete-soft-deleted (sweeps expired
 *     softDeletedAt rows)
 *   - the cancel/restore HTTP endpoint flow that lives in book8-ai
 *     (BOO-CANCEL-1B), which calls this via internal RPC.
 *
 * Behaviour
 * ─────────
 * 1. Resolve the business by `id` or `businessId` on the book8-core mongoose
 *    connection. If already hard-deleted (hardDeletedAt set) we return early
 *    so re-running the cron is safe.
 * 2. Release the assigned Twilio number on the carrier itself by calling
 *    twilioClient.incomingPhoneNumbers(sid).remove() — this is what makes
 *    the number reusable in the wider Twilio account. Failures here are
 *    logged but do not abort the rest of the cascade (the audit log records
 *    the partial state).
 * 3. Cascade-delete tenant rows in book8-core (bookings, services, schedules,
 *    providers, waitlists, reviews, smsConversations, calls).
 * 4. Optionally cascade-delete the same business in the book8 dashboard DB
 *    (cross-DB aware). The book8 connection is opened lazily from
 *    MONGODB_URI_BOOK8 (or derived from the active core URI) and closed
 *    after the operation completes.
 * 5. Mark the business document as `hardDeletedAt = now` (NOT physically
 *    removed) so we keep an idempotency guard. This matches the spec:
 *    "running twice doesn't double-delete or double-release Twilio numbers".
 *
 * Out of scope
 * ────────────
 * - Calling Stripe (refunds / subscription.cancel) — that lives in BOO-CANCEL-1B.
 * - Notifying the user — also BOO-CANCEL-1B.
 * - Removing the Business document itself in core. We keep it as a tombstone
 *   so the audit trail and any FK lookups still resolve.
 *
 * Safety rails
 * ────────────
 * - Never operates on the live "Diamond Rideau" business (biz_mnmqsh4xnfygae).
 *   Callers can override `allowProtectedBusiness` for tests, but the default
 *   refuses to touch it.
 */
import mongoose from "mongoose";
import twilio from "twilio";

import { Business } from "../models/Business.js";
import { Booking } from "../models/Booking.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { Provider } from "../models/Provider.js";
import { Waitlist } from "../models/Waitlist.js";
import { Review } from "../models/Review.js";
import { SmsConversation } from "../models/SmsConversation.js";
import { Call } from "../models/Call.js";
import { TwilioNumber } from "../models/TwilioNumber.js";
import { audit } from "../src/utils/auditLog.js";

/** Hardcoded protection for the only currently-live business. */
const PROTECTED_BUSINESS_IDS = new Set(["biz_mnmqsh4xnfygae"]);
const PROTECTED_PHONE_NUMBERS = new Set(["+14318163850"]);

/**
 * Replace the trailing /<dbname>(?...) segment in a mongo URI with /book8.
 * Returns null if the URI does not contain a path-style db name.
 */
function deriveBook8UriFromCore(uri) {
  if (!uri || typeof uri !== "string") return null;
  const replaced = uri.replace(/\/([a-zA-Z0-9_-]+)(\?|$)/, "/book8$2");
  return replaced !== uri ? replaced : null;
}

/**
 * Build a Twilio REST client from env. Returns null if not configured;
 * callers should treat that as a soft-skip (log + continue).
 */
function buildTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  try {
    return twilio(accountSid, authToken);
  } catch (err) {
    console.error(
      "[businessHardDelete] failed to build Twilio client:",
      err && err.message ? err.message : err
    );
    return null;
  }
}

/**
 * Release a Twilio incoming phone number on the carrier and update our pool
 * record. Idempotent: if the number is already removed at Twilio (HTTP 404)
 * we still mark our pool row as available and resolve OK.
 *
 * @param {Object} args
 * @param {string} [args.twilioSid]    Stored SID (from TwilioNumber.twilioSid)
 * @param {string} [args.phoneNumber]  Phone number (E.164) — used as fallback lookup
 * @param {Object} [args.twilioClient] Pre-built Twilio client (optional, useful in tests)
 * @returns {Promise<{released: boolean, error?: string, sid?: string, phoneNumber?: string}>}
 */
export async function releaseTwilioNumberHttp({
  twilioSid = null,
  phoneNumber = null,
  twilioClient = null
} = {}) {
  if (!twilioSid && !phoneNumber) {
    return { released: false, error: "no_sid_or_number" };
  }
  if (phoneNumber && PROTECTED_PHONE_NUMBERS.has(phoneNumber)) {
    return { released: false, error: "protected_phone_number", phoneNumber };
  }

  const client = twilioClient || buildTwilioClient();
  if (!client) {
    return { released: false, error: "twilio_not_configured", sid: twilioSid, phoneNumber };
  }

  let sid = twilioSid;
  if (!sid && phoneNumber) {
    try {
      const list = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
      if (list && list.length > 0 && list[0].sid) {
        sid = list[0].sid;
      }
    } catch (lookupErr) {
      console.error(
        "[businessHardDelete] Twilio number lookup failed:",
        lookupErr && lookupErr.message ? lookupErr.message : lookupErr
      );
    }
  }

  if (!sid) {
    return { released: false, error: "sid_unresolved", phoneNumber };
  }

  try {
    await client.incomingPhoneNumbers(sid).remove();
    return { released: true, sid, phoneNumber };
  } catch (err) {
    const status = err && (err.status || err.statusCode);
    if (status === 404) {
      return { released: true, sid, phoneNumber, alreadyReleased: true };
    }
    console.error(
      "[businessHardDelete] Twilio remove() failed:",
      err && err.message ? err.message : err
    );
    return {
      released: false,
      error: err && err.message ? err.message : "twilio_remove_failed",
      sid,
      phoneNumber
    };
  }
}

async function deleteCoreTenantRows(bizIds) {
  const filter = { businessId: { $in: bizIds } };
  const out = {};
  out.bookings = (await Booking.deleteMany(filter)).deletedCount || 0;
  out.services = (await Service.deleteMany(filter)).deletedCount || 0;
  out.schedules = (await Schedule.deleteMany(filter)).deletedCount || 0;
  try {
    out.providers = (await Provider.deleteMany(filter)).deletedCount || 0;
  } catch {
    out.providers = 0;
  }
  try {
    out.waitlists = (await Waitlist.deleteMany(filter)).deletedCount || 0;
  } catch {
    out.waitlists = 0;
  }
  try {
    out.reviews = (await Review.deleteMany(filter)).deletedCount || 0;
  } catch {
    out.reviews = 0;
  }
  out.smsConversations = (await SmsConversation.deleteMany(filter)).deletedCount || 0;
  out.calls = (await Call.deleteMany(filter)).deletedCount || 0;
  return out;
}

async function deleteBook8DashboardRows({ bizIds, uri }) {
  if (!uri) return { skipped: true, reason: "no_book8_uri" };
  if (!Array.isArray(bizIds) || bizIds.length === 0) {
    return { skipped: true, reason: "no_business_ids" };
  }

  let conn;
  try {
    conn = await mongoose.createConnection(uri).asPromise();
    const db = conn.db;
    const filter = { businessId: { $in: bizIds } };

    const out = {};
    const collections = [
      "bookings",
      "services",
      "schedules",
      "calls",
      "smsconversations",
      "google_events",
      "public_booking_tokens",
      "ops_audit_logs",
      "ops_executions",
      "provisioningAlerts",
      "status_checks",
      "billing_logs"
    ];
    for (const coll of collections) {
      try {
        out[coll] = (await db.collection(coll).deleteMany(filter)).deletedCount || 0;
      } catch {
        out[coll] = 0;
      }
    }

    try {
      const r = await db.collection("twilionumbers").updateMany(
        { assignedToBusinessId: { $in: bizIds } },
        { $set: { assignedToBusinessId: null, assignedAt: null, status: "available" } }
      );
      out.twilionumbersReleased = r.modifiedCount ?? r.nModified ?? 0;
    } catch {
      out.twilionumbersReleased = 0;
    }

    try {
      const r = await db.collection("businesses").deleteMany({
        $or: [{ id: { $in: bizIds } }, { businessId: { $in: bizIds } }]
      });
      out.businesses = r.deletedCount || 0;
    } catch {
      out.businesses = 0;
    }

    return { skipped: false, db: db.databaseName, deleted: out };
  } catch (err) {
    console.error(
      "[businessHardDelete] book8 dashboard cascade failed:",
      err && err.message ? err.message : err
    );
    return {
      skipped: false,
      error: err && err.message ? err.message : "book8_cascade_failed"
    };
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Hard-delete a business and cascade across book8-core (and optionally book8).
 *
 * @param {Object} args
 * @param {string} args.businessId
 *   The canonical business id (matches Business.id or Business.businessId).
 * @param {Object} [args.business]
 *   Optional pre-loaded business document (lean object) — saves a roundtrip
 *   when the cron has already loaded the row.
 * @param {string} [args.reason]
 *   Free-form reason recorded in the audit log context.
 * @param {string} [args.actor]
 *   Who triggered this delete (e.g. "cron:hard-delete-soft-deleted",
 *   "internal:cancel-account"). Persisted in audit log.
 * @param {boolean} [args.allowProtectedBusiness=false]
 *   Test-only escape hatch for the Diamond Rideau guard.
 * @param {Object} [args.twilioClient]
 *   Optional pre-built Twilio client (used by tests).
 * @param {string} [args.book8Uri]
 *   Override the dashboard DB URI (defaults to MONGODB_URI_BOOK8 or derived
 *   from active core URI). Pass `false` to skip cross-DB cascade entirely.
 * @returns {Promise<Object>} Structured report (also persisted to ops_event_logs).
 */
export async function hardDeleteBusiness({
  businessId,
  business: preloaded = null,
  reason = null,
  actor = "internal",
  allowProtectedBusiness = false,
  twilioClient = null,
  book8Uri = undefined
} = {}) {
  const startedAt = new Date();
  if (!businessId || typeof businessId !== "string") {
    return { ok: false, error: "businessId_required" };
  }

  if (!allowProtectedBusiness && PROTECTED_BUSINESS_IDS.has(businessId)) {
    await audit.cancellationFailed(businessId, {
      reason: "protected_business",
      actor,
      requestedReason: reason
    });
    return { ok: false, error: "protected_business", businessId };
  }

  let business = preloaded;
  if (!business) {
    business = await Business.findOne({
      $or: [{ id: businessId }, { businessId }]
    }).lean();
  }

  if (!business) {
    await audit.cancellationFailed(businessId, {
      reason: "business_not_found",
      actor
    });
    return { ok: false, error: "business_not_found", businessId };
  }

  if (business.hardDeletedAt) {
    return {
      ok: true,
      businessId,
      alreadyHardDeleted: true,
      hardDeletedAt: business.hardDeletedAt
    };
  }

  if (
    !allowProtectedBusiness &&
    business.assignedTwilioNumber &&
    PROTECTED_PHONE_NUMBERS.has(business.assignedTwilioNumber)
  ) {
    await audit.cancellationFailed(businessId, {
      reason: "protected_phone_number",
      assignedTwilioNumber: business.assignedTwilioNumber,
      actor
    });
    return {
      ok: false,
      error: "protected_phone_number",
      businessId,
      assignedTwilioNumber: business.assignedTwilioNumber
    };
  }

  const bizIds = [...new Set([business.id, business.businessId, businessId].filter(Boolean))].map(
    String
  );

  let twilioRelease = { skipped: true, reason: "no_assigned_number" };
  if (business.assignedTwilioNumber) {
    let twilioRow = null;
    try {
      twilioRow = await TwilioNumber.findOne({
        $or: [
          { phoneNumber: business.assignedTwilioNumber },
          { assignedToBusinessId: { $in: bizIds } }
        ]
      }).lean();
    } catch {
      twilioRow = null;
    }

    const releaseResult = await releaseTwilioNumberHttp({
      twilioSid: twilioRow?.twilioSid || null,
      phoneNumber: business.assignedTwilioNumber,
      twilioClient
    });

    try {
      // After a successful carrier-side release, the pool row points to a
      // Twilio SID that no longer exists, so we delete it to avoid the
      // replenish-pool cron handing it back out. If the carrier release
      // failed (e.g. transient network), keep the row available so the
      // next cron pass can retry without manual cleanup.
      const poolFilter = {
        $or: [
          { phoneNumber: business.assignedTwilioNumber },
          { assignedToBusinessId: { $in: bizIds } }
        ]
      };
      if (releaseResult.released) {
        await TwilioNumber.deleteMany(poolFilter);
      } else {
        await TwilioNumber.updateMany(poolFilter, {
          $set: {
            status: "available",
            assignedToBusinessId: null,
            assignedAt: null,
            updatedAt: new Date()
          }
        });
      }
    } catch (poolErr) {
      console.error(
        "[businessHardDelete] failed to update TwilioNumber pool row:",
        poolErr && poolErr.message ? poolErr.message : poolErr
      );
    }

    twilioRelease = {
      skipped: false,
      ...releaseResult,
      assignedTwilioNumber: business.assignedTwilioNumber
    };
  }

  const coreDeleted = await deleteCoreTenantRows(bizIds);

  const resolvedBook8Uri =
    book8Uri === false
      ? null
      : book8Uri ||
        process.env.MONGODB_URI_BOOK8 ||
        deriveBook8UriFromCore(process.env.MONGODB_URI || process.env.MONGO_URI);

  const book8Result = await deleteBook8DashboardRows({
    bizIds,
    uri: resolvedBook8Uri
  });

  const hardDeletedAt = new Date();
  try {
    await Business.updateOne(
      { _id: business._id },
      {
        $set: {
          hardDeletedAt,
          "subscription.canceledAt": business?.subscription?.canceledAt || hardDeletedAt
        }
      }
    );
  } catch (markErr) {
    console.error(
      "[businessHardDelete] failed to mark hardDeletedAt:",
      markErr && markErr.message ? markErr.message : markErr
    );
  }

  const report = {
    ok: true,
    businessId,
    bizIds,
    actor,
    reason,
    startedAt,
    hardDeletedAt,
    twilio: twilioRelease,
    coreDeleted,
    book8: book8Result
  };

  await audit.businessHardDeleted(businessId, report);

  return report;
}

export default { hardDeleteBusiness, releaseTwilioNumberHttp };

/**
 * BOO-CANCEL-1A — Cron endpoint: hard-delete soft-deleted businesses.
 *
 * Authentication: cron secret in `Authorization: Bearer <CRON_SECRET>` header
 * (matches the existing /api/cron/* convention in src/routes/cron.js).
 *
 * Behaviour:
 *   - Find businesses where `softDeletedAt < now - 24h` AND `hardDeletedAt`
 *     is null/missing.
 *   - For each, call `hardDeleteBusiness` from services/businessHardDelete.js.
 *   - Idempotent — `hardDeletedAt` is set after a successful run, so a
 *     subsequent invocation skips that row inside the service AND inside
 *     the query filter here.
 *   - Writes audit-log entries via the service (business_hard_deleted) and
 *     records cancellation_failed for any row that errors out.
 *
 * Optional query params:
 *   ?dryRun=1 → list candidates, do not invoke the service
 *   ?limit=50 → cap rows scanned per run (default 50, hard max 200)
 *   ?graceHours=24 → override 24h soft-delete grace (default 24)
 */
import express from "express";
import { Business } from "../../../models/Business.js";
import { safeCompare } from "../../middleware/internalAuth.js";
import { hardDeleteBusiness } from "../../../services/businessHardDelete.js";
import { audit } from "../../utils/auditLog.js";

const router = express.Router();

const DEFAULT_LIMIT = 50;
const HARD_MAX_LIMIT = 200;
const DEFAULT_GRACE_HOURS = 24;

function authorizedCronRequest(req) {
  const authHeader = req.headers["authorization"];
  const token =
    authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
  const expected = process.env.CRON_SECRET;
  if (!expected || !token) return false;
  return safeCompare(token, expected);
}

router.get("/hard-delete-soft-deleted", async (req, res) => {
  try {
    if (!authorizedCronRequest(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const dryRun =
      req.query.dryRun === "1" ||
      req.query.dryRun === "true" ||
      req.query.dryRun === "yes";

    let limit = Number.parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
    if (limit > HARD_MAX_LIMIT) limit = HARD_MAX_LIMIT;

    let graceHours = Number.parseFloat(String(req.query.graceHours ?? DEFAULT_GRACE_HOURS));
    if (!Number.isFinite(graceHours) || graceHours < 0) graceHours = DEFAULT_GRACE_HOURS;

    const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000);

    const candidates = await Business.find({
      softDeletedAt: { $lt: cutoff },
      $or: [{ hardDeletedAt: null }, { hardDeletedAt: { $exists: false } }]
    })
      .limit(limit)
      .lean();

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        cutoff,
        graceHours,
        candidates: candidates.map((b) => ({
          businessId: b.id || b.businessId,
          name: b.name,
          softDeletedAt: b.softDeletedAt,
          assignedTwilioNumber: b.assignedTwilioNumber || null
        }))
      });
    }

    const results = [];
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let alreadyDeleted = 0;

    for (const b of candidates) {
      processed++;
      const businessId = b.id || b.businessId;
      if (!businessId) {
        failed++;
        results.push({
          businessId: null,
          ok: false,
          error: "missing_business_id",
          _id: String(b._id)
        });
        continue;
      }

      try {
        const out = await hardDeleteBusiness({
          businessId,
          business: b,
          reason: b.subscription?.cancellationReason || "soft_delete_grace_expired",
          actor: "cron:hard-delete-soft-deleted"
        });

        if (out.ok && out.alreadyHardDeleted) {
          alreadyDeleted++;
        } else if (out.ok) {
          succeeded++;
        } else {
          failed++;
          await audit.cancellationFailed(businessId, {
            actor: "cron:hard-delete-soft-deleted",
            error: out.error || "unknown",
            details: out
          });
        }
        results.push({ businessId, ...out });
      } catch (err) {
        failed++;
        const message = err && err.message ? err.message : String(err);
        console.error(
          `[hard-delete-soft-deleted] error for ${businessId}:`,
          message
        );
        await audit.cancellationFailed(businessId, {
          actor: "cron:hard-delete-soft-deleted",
          error: message
        });
        results.push({ businessId, ok: false, error: message });
      }
    }

    return res.json({
      ok: true,
      cutoff,
      graceHours,
      processed,
      succeeded,
      failed,
      alreadyDeleted,
      results
    });
  } catch (err) {
    console.error("[hard-delete-soft-deleted] fatal:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

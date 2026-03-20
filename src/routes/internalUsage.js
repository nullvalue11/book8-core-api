// src/routes/internalUsage.js
import express from "express";
import { Call } from "../models/Call.js";

const router = express.Router();

/** Max time for aggregation (ms). Prevents hanging past Render/proxy ~30s limits. */
const USAGE_AGG_MAX_MS = Math.min(
  Math.max(parseInt(process.env.USAGE_SUMMARY_MAX_MS || "12000", 10), 1000),
  25000
);

/**
 * Parse from/to for $match on startTime.
 * - Full ISO strings (e.g. ...T00:00:00.000Z from book8-ai): use as-is (do not setHours — that breaks UTC).
 * - Date-only YYYY-MM-DD: expand to local calendar day (legacy).
 */
function parseRangeQuery(from, to) {
  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
      const dateOnly = !String(from).includes("T") && !String(to).includes("T");
      if (dateOnly) {
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);
      }
      return { fromDate, toDate };
    }
  }
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - 24 * 60 * 60 * 1000);
  return { fromDate, toDate };
}

function emptySummaryResponse(businessId, fromDate, toDate, degraded, extra = {}) {
  return {
    ok: true,
    businessId,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    calls: 0,
    durationSeconds: 0,
    minutes: 0,
    llmTokens: 0,
    ttsCharacters: 0,
    ...(degraded ? { degraded: true } : {}),
    ...extra
  };
}

// GET /internal/usage/summary
router.get("/summary", async (req, res) => {
  const started = Date.now();
  try {
    const { businessId, from, to } = req.query;

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: "Query parameter 'businessId' is required"
      });
    }

    const { fromDate, toDate } = parseRangeQuery(from, to);

    // MongoDB aggregation pipeline
    const pipeline = [
      {
        $match: {
          businessId: businessId,
          startTime: {
            $gte: fromDate,
            $lte: toDate
          }
        }
      },
      {
        $group: {
          _id: null,
          calls: { $sum: 1 },
          durationSeconds: { $sum: "$durationSeconds" },
          llmTokens: { $sum: "$usage.llmTokens" },
          ttsCharacters: { $sum: "$usage.ttsCharacters" }
        }
      }
    ];

    const agg = Call.aggregate(pipeline).option({ maxTimeMS: USAGE_AGG_MAX_MS });

    let result;
    try {
      result = await Promise.race([
        agg.exec(),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error("USAGE_SUMMARY_TIMEOUT"), { code: "TIMEOUT" })), USAGE_AGG_MAX_MS + 2000)
        )
      ]);
    } catch (err) {
      const code = err?.code;
      const timedOut =
        err?.code === "TIMEOUT" ||
        code === 50 ||
        String(err?.message || "").includes("timeout") ||
        String(err?.message || "").includes("MaxTimeMSExpired");
      if (timedOut) {
        console.warn(
          "[usage/summary] aggregation slow or timeout — returning zeros",
          { businessId, ms: Date.now() - started, USAGE_AGG_MAX_MS }
        );
        return res.json(emptySummaryResponse(businessId, fromDate, toDate, true));
      }
      throw err;
    }

    // If no calls found, return zeros
    const summary = result[0] || {
      calls: 0,
      durationSeconds: 0,
      llmTokens: 0,
      ttsCharacters: 0
    };

    // Calculate minutes (using Math.ceil as specified)
    const minutes = Math.ceil((summary.durationSeconds || 0) / 60);

    res.json({
      ok: true,
      businessId,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      calls: summary.calls || 0,
      durationSeconds: summary.durationSeconds || 0,
      minutes,
      llmTokens: summary.llmTokens || 0,
      ttsCharacters: summary.ttsCharacters || 0
    });
  } catch (err) {
    console.error("Error in GET /internal/usage/summary:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;


// src/routes/internalUsage.js
import express from "express";
import { Call } from "../models/Call.js";

const router = express.Router();

// GET /internal/usage/summary
router.get("/summary", async (req, res) => {
  try {
    const { businessId, from, to } = req.query;

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: "Query parameter 'businessId' is required"
      });
    }

    // Parse dates (format: YYYY-MM-DD)
    // Default to last 24 hours if missing
    let fromDate, toDate;
    
    if (from && to) {
      fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
    } else {
      // Default to last 24 hours
      toDate = new Date();
      fromDate = new Date(toDate.getTime() - 24 * 60 * 60 * 1000);
    }

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

    const result = await Call.aggregate(pipeline);

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


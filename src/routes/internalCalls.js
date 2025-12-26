// src/routes/internalCalls.js
import express from "express";
import { Call } from "../models/Call.js";

const router = express.Router();

// POST /internal/calls/start
router.post("/start", async (req, res) => {
  try {
    const { callSid, businessId, from, to } = req.body;

    console.log("[CALL_START] Request received:", { callSid, businessId, from, to });

    if (!callSid || !businessId) {
      console.warn("[CALL_START] Missing required fields:", { hasCallSid: !!callSid, hasBusinessId: !!businessId });
      return res.status(400).json({
        ok: false,
        error: "Fields 'callSid' and 'businessId' are required"
      });
    }

    const now = new Date();

    // Upsert on callSid. Do NOT overwrite businessId if it already exists.
    const updated = await Call.findOneAndUpdate(
      { callSid },
      {
        $setOnInsert: {
          callSid,
          businessId,
          fromNumber: from,
          toNumber: to,
          status: "initiated",
          startTime: now
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    console.log("[CALL_START] Success:", { callSid, callId: updated._id });
    return res.json({ ok: true, call: updated });
  } catch (err) {
    console.error("[CALL_START] Error:", err);
    console.error("[CALL_START] Error stack:", err.stack);
    console.error("[CALL_START] Error name:", err.name);
    console.error("[CALL_START] Error message:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
      details: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
});

// POST /internal/calls/transcript
router.post("/transcript", async (req, res) => {
  try {
    const { callSid, role, text, timestamp, turnId } = req.body;

    if (!callSid || !role || !text) {
      return res.status(400).json({
        ok: false,
        error: "Fields 'callSid', 'role', and 'text' are required"
      });
    }

    if (!["caller", "agent"].includes(role)) {
      return res.status(400).json({ ok: false, error: "Invalid role" });
    }

    // Idempotency: if turnId exists and already recorded, no-op
    if (turnId) {
      const exists = await Call.findOne({
        callSid,
        "transcript.turnId": turnId
      }).select({ _id: 1 }).lean();

      if (exists) return res.json({ ok: true, noop: true });
    }

    const entry = {
      role,
      text,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      ...(turnId ? { turnId } : {})
    };

    const result = await Call.findOneAndUpdate(
      { callSid },
      { $push: { transcript: entry } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({ ok: true, call: result });
  } catch (err) {
    console.error("Error in POST /internal/calls/transcript:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /internal/calls/tool
router.post("/tool", async (req, res) => {
  try {
    const { callSid, tool, success, timestamp, eventId } = req.body;

    if (!callSid || !tool) {
      return res.status(400).json({
        ok: false,
        error: "Fields 'callSid' and 'tool' are required"
      });
    }

    if (eventId) {
      const exists = await Call.findOne({
        callSid,
        "toolsUsed.eventId": eventId
      }).select({ _id: 1 }).lean();

      if (exists) return res.json({ ok: true, noop: true });
    }

    const entry = {
      name: tool,
      success: typeof success === "boolean" ? success : true,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      ...(eventId ? { eventId } : {})
    };

    const result = await Call.findOneAndUpdate(
      { callSid },
      { $push: { toolsUsed: entry } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({ ok: true, call: result });
  } catch (err) {
    console.error("Error in POST /internal/calls/tool:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /internal/calls/usage
router.post("/usage", async (req, res) => {
  try {
    const { callSid, delta } = req.body;

    if (!callSid || !delta || typeof delta !== "object") {
      return res.status(400).json({
        ok: false,
        error: "Fields 'callSid' and 'delta' are required"
      });
    }

    const llmTokens = Number(delta.llmTokens || 0);
    const ttsCharacters = Number(delta.ttsCharacters || 0);
    const sttSeconds = Number(delta.sttSeconds || 0);

    // No negative deltas (avoid accidental rollback / abuse)
    if (llmTokens < 0 || ttsCharacters < 0 || sttSeconds < 0) {
      return res.status(400).json({
        ok: false,
        error: "Usage deltas must be non-negative"
      });
    }

    const inc = {};
    if (llmTokens) inc["usage.llmTokens"] = llmTokens;
    if (ttsCharacters) inc["usage.ttsCharacters"] = ttsCharacters;
    if (sttSeconds) inc["usage.sttSeconds"] = sttSeconds;

    // If nothing to increment, just no-op
    if (Object.keys(inc).length === 0) return res.json({ ok: true, noop: true });

    const result = await Call.findOneAndUpdate(
      { callSid },
      { $inc: inc },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({ ok: true, call: result });
  } catch (err) {
    console.error("Error in POST /internal/calls/usage:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /internal/calls/end
router.post("/end", async (req, res) => {
  try {
    const { callSid, status, durationSeconds, endTime } = req.body;

    if (!callSid) {
      return res.status(400).json({ ok: false, error: "Field 'callSid' is required" });
    }

    const finalStatus =
      status && ["completed", "failed", "in_progress", "initiated"].includes(status)
        ? status
        : "completed";

    const update = {
      status: finalStatus,
      endTime: endTime ? new Date(endTime) : new Date()
    };

    if (typeof durationSeconds === "number") update.durationSeconds = durationSeconds;
    if (typeof durationSeconds === "string" && durationSeconds.trim() !== "") {
      const n = Number(durationSeconds);
      if (!Number.isNaN(n)) update.durationSeconds = n;
    }

    // upsert minimal record in case callback arrives without /start
    const result = await Call.findOneAndUpdate(
      { callSid },
      { $set: update, $setOnInsert: { callSid, startTime: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({ ok: true, call: result });
  } catch (err) {
    console.error("Error in POST /internal/calls/end:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// GET /internal/calls/:callSid (internal-only read)
router.get("/:callSid", async (req, res) => {
  try {
    const { callSid } = req.params;

    const call = await Call.findOne({ callSid }).lean();
    if (!call) return res.status(404).json({ ok: false, error: "Call not found" });

    return res.json({ ok: true, call });
  } catch (err) {
    console.error("Error in GET /internal/calls/:callSid:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

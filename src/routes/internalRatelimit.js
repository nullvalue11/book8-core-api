// src/routes/internalRatelimit.js — BOO-RATELIMIT-CORE-1A
import express from "express";
import { checkRateLimit } from "../lib/rateLimiter.js";

const router = express.Router();

/**
 * POST /internal/ratelimit/check
 * Body: { key, limit, windowSeconds, namespace? }
 * Response: { ok, allowed, remaining, resetAt }
 */
router.post("/check", async (req, res) => {
  try {
    const { key, limit, windowSeconds, namespace } = req.body ?? {};

    if (!key || typeof key !== "string") {
      return res.status(400).json({ ok: false, error: "key is required (string)" });
    }
    if (!Number.isFinite(Number(limit)) || Number(limit) < 1) {
      return res.status(400).json({ ok: false, error: "limit must be a positive number" });
    }
    if (!Number.isFinite(Number(windowSeconds)) || Number(windowSeconds) < 1) {
      return res.status(400).json({ ok: false, error: "windowSeconds must be a positive number" });
    }
    if (namespace != null && typeof namespace !== "string") {
      return res.status(400).json({ ok: false, error: "namespace must be a string when provided" });
    }

    const result = await checkRateLimit({
      key,
      limit: Number(limit),
      windowSeconds: Number(windowSeconds),
      namespace: namespace || "default"
    });

    return res.json({
      ok: true,
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: result.resetAt.toISOString()
    });
  } catch (err) {
    console.error("[internal/ratelimit/check]", err);
    return res.status(500).json({ ok: false, error: "Rate limit check failed" });
  }
});

export default router;

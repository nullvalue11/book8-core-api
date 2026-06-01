/**
 * BOO-RATELIMIT-CORE-1A — Mongo-backed fixed-window rate limiter.
 *
 * Pattern mirrors book8-ai ops limiter (ops_rate_limits):
 * - Fixed-window via floor(now / windowMs)
 * - Atomic findOneAndUpdate + upsert
 * - TTL index on resetAt (expireAfterSeconds: 0) for bucket cleanup
 *
 * @see book8-ai/app/api/internal/ops/_lib/rateLimiter.ts
 */
import { RateLimitBucket } from "../../models/RateLimitBucket.js";

let indexesEnsured = false;

/**
 * Ensure TTL + unique indexes exist (idempotent; safe on Render boot).
 */
export async function ensureRateLimitIndexes() {
  if (indexesEnsured) return;
  await RateLimitBucket.syncIndexes();
  indexesEnsured = true;
}

/**
 * @param {{ key: string, limit: number, windowSeconds: number, namespace?: string }} params
 * @returns {Promise<{ allowed: boolean, remaining: number, resetAt: Date }>}
 */
export async function checkRateLimit({ key, limit, windowSeconds, namespace = "default" }) {
  if (!key || typeof key !== "string") {
    throw new Error("checkRateLimit: key is required");
  }
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("checkRateLimit: limit must be a positive number");
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds < 1) {
    throw new Error("checkRateLimit: windowSeconds must be a positive number");
  }

  await ensureRateLimitIndexes();

  const windowMs = windowSeconds * 1000;
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);
  const bucketKey = `${namespace}|${key}|${windowStart.getTime()}`;

  const doc = await RateLimitBucket.findOneAndUpdate(
    { bucketKey },
    {
      $inc: { count: 1 },
      $setOnInsert: {
        bucketKey,
        namespace,
        windowStart,
        resetAt
      }
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  ).lean();

  const count = doc?.count ?? 1;
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);

  return { allowed, remaining, resetAt };
}

// src/middleware/internalAuth.js
import { timingSafeEqual } from "crypto";

/**
 * Constant-time comparison for secrets (length mismatch still branches but avoids early exit on first char).
 */
export function safeCompare(a, b) {
  if (a == null || b == null) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    if (bufA.length > 0) timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** True when caller presents the same secret {@link requireInternalAuth} expects (no response sent). */
export function isInternalCoreApiRequest(req) {
  const authHeader = req.headers["x-internal-secret"] || req.headers["x-book8-internal-secret"];
  const expectedSecret =
    process.env.CORE_API_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET;
  return !!(expectedSecret && authHeader && safeCompare(authHeader, expectedSecret));
}

export const requireInternalAuth = (req, res, next) => {
  // Support both header names (older code uses x-book8-internal-secret; some callers use x-internal-secret)
  const authHeader = req.headers["x-internal-secret"] || req.headers["x-book8-internal-secret"];
  const expectedSecret =
    process.env.CORE_API_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET;

  if (!expectedSecret) {
    console.error(
      "[INTERNAL_AUTH] CORE_API_INTERNAL_SECRET or INTERNAL_API_SECRET environment variable is not set"
    );
    console.error("[INTERNAL_AUTH] Request path:", req.path);
    console.error("[INTERNAL_AUTH] Request method:", req.method);
    return res.status(500).json({
      ok: false,
      error: "Server configuration error: INTERNAL_API_SECRET not configured"
    });
  }

  if (!authHeader) {
    console.warn("[INTERNAL_AUTH] Missing x-book8-internal-secret header");
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: Missing internal auth secret header"
    });
  }

  if (!safeCompare(authHeader, expectedSecret)) {
    console.warn("[INTERNAL_AUTH] Invalid auth attempt");
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: Invalid internal auth secret"
    });
  }

  next();
};

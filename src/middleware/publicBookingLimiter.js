/**
 * BOO-84A — Relaxed limiter for unauthenticated public booking flows (calendar, confirm booking, business public payload).
 */
import rateLimit from "express-rate-limit";

export const publicBookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "rate_limit_exceeded",
    message: "Too many requests. Please wait a moment and try again."
  }
});

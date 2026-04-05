import jwt from "jsonwebtoken";

export function getReviewJwtSecret() {
  return (
    process.env.REVIEW_JWT_SECRET ||
    process.env.CORE_API_INTERNAL_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    ""
  );
}

/**
 * @param {string} bookingId
 * @param {string} businessId
 * @returns {string}
 */
export function signReviewToken(bookingId, businessId) {
  const secret = getReviewJwtSecret();
  if (!secret) throw new Error("REVIEW_JWT_SECRET or INTERNAL_API_SECRET required for review tokens");
  return jwt.sign(
    { bookingId, businessId, typ: "review" },
    secret,
    { expiresIn: "7d" }
  );
}

/**
 * @param {string} token
 * @returns {{ ok: true, bookingId: string, businessId: string } | { ok: false, error: string }}
 */
export function verifyReviewToken(token) {
  const secret = getReviewJwtSecret();
  if (!secret || !token) {
    return { ok: false, error: "Invalid token" };
  }
  try {
    const p = jwt.verify(token, secret);
    if (p.typ !== "review" || !p.bookingId || !p.businessId) {
      return { ok: false, error: "Invalid token" };
    }
    return { ok: true, bookingId: String(p.bookingId), businessId: String(p.businessId) };
  } catch (e) {
    if (e.name === "TokenExpiredError") return { ok: false, error: "Token expired" };
    return { ok: false, error: "Invalid token" };
  }
}

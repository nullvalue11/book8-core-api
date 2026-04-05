import jwt from "jsonwebtoken";

function secret() {
  return (
    process.env.WAITLIST_JWT_SECRET ||
    process.env.REVIEW_JWT_SECRET ||
    process.env.CORE_API_INTERNAL_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    ""
  );
}

export function signWaitlistCancelToken(waitlistId, businessId) {
  const s = secret();
  if (!s) throw new Error("WAITLIST_JWT_SECRET or INTERNAL_API_SECRET required for waitlist cancel tokens");
  return jwt.sign({ waitlistId, businessId, typ: "waitlist_cancel" }, s, { expiresIn: "30d" });
}

/**
 * @returns {{ ok: true, waitlistId: string, businessId: string } | { ok: false, error: string }}
 */
export function verifyWaitlistCancelToken(token) {
  const s = secret();
  if (!s || !token) return { ok: false, error: "Invalid token" };
  try {
    const p = jwt.verify(token, s);
    if (p.typ !== "waitlist_cancel" || !p.waitlistId || !p.businessId) {
      return { ok: false, error: "Invalid token" };
    }
    return { ok: true, waitlistId: String(p.waitlistId), businessId: String(p.businessId) };
  } catch (e) {
    if (e.name === "TokenExpiredError") return { ok: false, error: "Token expired" };
    return { ok: false, error: "Invalid token" };
  }
}

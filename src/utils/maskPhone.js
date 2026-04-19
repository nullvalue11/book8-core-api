import { createHash } from "crypto";

/** Mask E.164 / phone strings for logs (OWASP — avoid PII in log aggregators). */
export function maskPhone(phone) {
  if (phone == null || phone === "") return "***";
  const s = String(phone);
  if (s.length < 6) return "***";
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** Short SHA-256 prefix for structured logs (BOO-97A booking lookup). */
export function hashPhoneForLog(phone) {
  const s = phone == null ? "" : String(phone).trim();
  if (!s) return "(empty)";
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

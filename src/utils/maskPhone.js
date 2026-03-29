/** Mask E.164 / phone strings for logs (OWASP — avoid PII in log aggregators). */
export function maskPhone(phone) {
  if (phone == null || phone === "") return "***";
  const s = String(phone);
  if (s.length < 6) return "***";
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

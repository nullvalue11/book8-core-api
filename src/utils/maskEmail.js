/**
 * Mask an email for logs / agent prompts: first 2 chars of local part + ***@domain.
 * @param {unknown} email
 * @returns {string|null}
 */
export function maskEmail(email) {
  if (email == null || typeof email !== "string") return null;
  const s = email.trim();
  if (!s || !s.includes("@")) return null;
  const at = s.indexOf("@");
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!domain) return null;
  if (local.length <= 2) return `${local.slice(0, 1)}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

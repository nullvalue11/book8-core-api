/**
 * Detects whether a string looks like a masked email produced by maskEmail().
 * Format: 1–2 visible chars + *** + @domain.tld
 * @param {unknown} s
 * @returns {boolean}
 */
export function isMaskedEmail(s) {
  if (s == null || typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  return /^[^\s@]{1,2}\*{3}@\S+\.\S+$/.test(t);
}

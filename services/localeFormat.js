/**
 * Locale helpers for customer-facing booking copy (SMS/email).
 */

const LOCALE_BY_LANG = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  ar: "ar"
};

/** ISO 639-1 (first two chars) for template lookup. */
export function normalizeLangCode(raw) {
  if (raw == null || raw === "") return "en";
  const s = String(raw).trim().toLowerCase();
  return s.slice(0, 2) || "en";
}

export function localeForLanguage(lang) {
  const code = normalizeLangCode(lang);
  return LOCALE_BY_LANG[code] || "en-US";
}

/**
 * Format slot start in a timezone for display (date + time strings).
 * @param {string} slotStart - ISO string
 * @param {string} timezone - IANA tz
 * @param {string} [language] - booking language code
 */
export function formatSlotDateTime(slotStart, timezone, language = "en") {
  const tz = timezone || "America/Toronto";
  const locale = localeForLanguage(language);
  const d = new Date(slotStart);
  if (Number.isNaN(d.getTime())) {
    return { dateStr: "", timeStr: "" };
  }
  const dateStr = d.toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz
  });
  const timeStr = d.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz
  });
  return { dateStr, timeStr };
}

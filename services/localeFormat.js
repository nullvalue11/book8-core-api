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

/**
 * BOO-SMS-COMPLIANCE-1A: short date/time strings for SMS to keep messages within
 * 1–2 segments while still meeting CTIA / TCPA / 10DLC disclosure requirements.
 *
 * Returns:
 *   - dateStr   e.g. "Fri May 15, 2026" (en) / "Ven 15 mai, 2026" (fr) / "جمعة 15 مايو, 2026" (ar)
 *   - dateShort e.g. "May 15" (en) / "15 mai" (fr) / "15 may" (es) — used for cancellation copy
 *   - timeStr   e.g. "3:00 PM"
 *   - parts     individual fields { dayShort, dayNum, monthShort, year } for templates that
 *               want to compose their own ordering.
 */
export function formatSlotDateTimeShort(slotStart, timezone, language = "en") {
  const tz = timezone || "America/Toronto";
  const code = normalizeLangCode(language);
  const locale = localeForLanguage(language);
  const d = new Date(slotStart);
  if (Number.isNaN(d.getTime())) {
    return {
      dateStr: "",
      dateShort: "",
      timeStr: "",
      parts: { dayShort: "", dayNum: "", monthShort: "", year: "" }
    };
  }

  const dayShortRaw = d.toLocaleDateString(locale, { weekday: "short", timeZone: tz });
  const monthShortRaw = d.toLocaleDateString(locale, { month: "short", timeZone: tz });
  const dayNumRaw = d.toLocaleDateString(locale, { day: "numeric", timeZone: tz });
  const yearRaw = d.toLocaleDateString(locale, { year: "numeric", timeZone: tz });

  const stripPunct = (s) => String(s || "").replace(/[.,]+$/u, "").trim();
  const dayShort = stripPunct(dayShortRaw);
  const monthShort = stripPunct(monthShortRaw);
  const dayNum = stripPunct(dayNumRaw);
  const year = stripPunct(yearRaw);

  const dateStr =
    code === "en"
      ? `${dayShort} ${monthShort} ${dayNum}, ${year}`
      : `${dayShort} ${dayNum} ${monthShort}, ${year}`;

  const dateShort = code === "en" ? `${monthShort} ${dayNum}` : `${dayNum} ${monthShort}`;

  const timeStr = d.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz
  });

  return {
    dateStr,
    dateShort,
    timeStr,
    parts: { dayShort, dayNum, monthShort, year }
  };
}

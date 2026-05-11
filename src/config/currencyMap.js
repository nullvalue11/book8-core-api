/**
 * BOO-MULTI-CURRENCY-1A / BOO-MULTI-CURRENCY-FIX-1A:
 * map business country / phone → Stripe checkout currency.
 *
 * Home market is Canada (CAD). USD is the international fallback for unknown
 * countries; AED is the regional currency for Gulf customers.
 */

function normalizePhoneDigits(phone) {
  if (!phone) return null;
  const str = String(phone).trim();
  if (!str) return null;
  const normalized = str.replace(/[^\d+]/g, "");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

const COUNTRY_CURRENCY = {
  AE: "aed",
  SA: "aed",
  US: "usd",
  CA: "cad",
  GB: "usd"
};

const DEFAULT_CURRENCY = "usd";

/** E.164 digit prefix (without +) → ISO country for currency lookup */
const PHONE_PREFIX_COUNTRY = [
  ["971", "AE"],
  ["966", "SA"],
  ["1", "US"]
];

function normalizeCountryCode(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length === 2) return s.toUpperCase();
  const lower = s.toLowerCase();
  if (lower === "uae" || lower.includes("united arab emirates")) return "AE";
  if (lower === "ksa" || lower.includes("saudi")) return "SA";
  if (lower === "usa" || lower === "us" || lower.includes("united states")) return "US";
  if (lower === "ca" || lower.includes("canada")) return "CA";
  if (lower === "gb" || lower.includes("united kingdom")) return "GB";
  return null;
}

function countryFromE164Phone(phone) {
  const e164 = normalizePhoneDigits(phone);
  if (!e164 || !e164.startsWith("+")) return null;
  const digits = e164.slice(1);
  for (const [prefix, code] of PHONE_PREFIX_COUNTRY) {
    if (digits.startsWith(prefix)) return code;
  }
  return null;
}

/**
 * @param {string} countryCode - ISO-ish country (e.g. AE, US) or common label
 * @returns {string} lowercase currency code for Stripe
 */
export function getCurrencyForCountry(countryCode) {
  const iso = normalizeCountryCode(countryCode);
  if (iso && COUNTRY_CURRENCY[iso]) {
    return COUNTRY_CURRENCY[iso];
  }
  return DEFAULT_CURRENCY;
}

const SUPPORTED_OVERRIDE = new Set(["usd", "aed", "cad"]);

/**
 * @param {object} [business]
 * @returns {string} lowercase currency code
 */
export function getCurrencyForBusiness(business) {
  if (!business || typeof business !== "object") {
    return DEFAULT_CURRENCY;
  }

  const pref = business.preferredCurrency;
  if (typeof pref === "string" && pref.trim()) {
    const c = pref.trim().toLowerCase();
    if (SUPPORTED_OVERRIDE.has(c)) return c;
  }

  const fromCountry = normalizeCountryCode(business.country);
  if (fromCountry && COUNTRY_CURRENCY[fromCountry]) {
    return COUNTRY_CURRENCY[fromCountry];
  }

  const fromPhone =
    countryFromE164Phone(business.phoneNumber) ||
    countryFromE164Phone(business.businessProfile?.phone);
  if (fromPhone && COUNTRY_CURRENCY[fromPhone]) {
    return COUNTRY_CURRENCY[fromPhone];
  }

  return DEFAULT_CURRENCY;
}

export { COUNTRY_CURRENCY, DEFAULT_CURRENCY, normalizeCountryCode };

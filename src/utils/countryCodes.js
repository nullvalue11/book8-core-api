/**
 * BOO-TWILIO-UAE-NUMBERS-1A — map business / address country strings to ISO-3166 alpha-2
 * and group countries for Twilio pool fallback (same continent / region).
 */

/** @type {Record<string, string>} normalized name/alias (lowercase, single spaces) → ISO */
const NAME_OR_ALIAS_TO_ISO = {
  "united states": "US",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  canada: "CA",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "great britain": "GB",
  france: "FR",
  germany: "DE",
  spain: "ES",
  italy: "IT",
  mexico: "MX",
  "united arab emirates": "AE",
  uae: "AE",
  "u.a.e.": "AE",
  dubai: "AE",
  "abu dhabi": "AE",
  "saudi arabia": "SA",
  kuwait: "KW",
  qatar: "QA",
  bahrain: "BH",
  oman: "OM",
  egypt: "EG",
  jordan: "JO",
  lebanon: "LB",
  israel: "IL",
  india: "IN",
  china: "CN",
  japan: "JP",
  australia: "AU"
};

function collapseSpaces(s) {
  return String(s)
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCountryKey(s) {
  return collapseSpaces(s).toLowerCase();
}

/**
 * @param {string|null|undefined} input — full name, alias, or two-letter ISO
 * @returns {string|null} ISO alpha-2 or null if unmapped
 */
export function mapCountryNameToCode(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return NAME_OR_ALIAS_TO_ISO[normalizeCountryKey(s)] || null;
}

/**
 * ISO code for pool selection; defaults to CA (Book8's primary market) when unset.
 * @param {object} business — lean Business doc
 * @returns {string}
 */
export function resolveBusinessCountryIso(business) {
  const raw = business?.businessProfile?.address?.country || business?.country || "";
  const mapped = mapCountryNameToCode(raw);
  if (mapped) return mapped;
  const fall = process.env.BOOK8_DEFAULT_BUSINESS_COUNTRY || "CA";
  return String(fall).length === 2 ? String(fall).toUpperCase() : "CA";
}

/** Canadian area codes (NANP) — US vs CA split for +1 E.164 */
const CA_AREA_CODES = new Set([
  "204",
  "226",
  "236",
  "249",
  "250",
  "263",
  "289",
  "306",
  "343",
  "354",
  "365",
  "367",
  "368",
  "382",
  "403",
  "416",
  "418",
  "428",
  "431",
  "437",
  "438",
  "450",
  "468",
  "474",
  "506",
  "514",
  "519",
  "548",
  "579",
  "581",
  "584",
  "587",
  "600",
  "604",
  "613",
  "639",
  "647",
  "672",
  "683",
  "705",
  "709",
  "742",
  "753",
  "778",
  "780",
  "782",
  "807",
  "819",
  "825",
  "867",
  "873",
  "879",
  "902",
  "905"
]);

const PREFIX_TO_ISO = [
  ["+971", "AE"],
  ["+966", "SA"],
  ["+965", "KW"],
  ["+974", "QA"],
  ["+973", "BH"],
  ["+968", "OM"],
  ["+962", "JO"],
  ["+961", "LB"],
  ["+972", "IL"],
  ["+20", "EG"],
  ["+44", "GB"],
  ["+33", "FR"],
  ["+49", "DE"],
  ["+34", "ES"],
  ["+39", "IT"],
  ["+31", "NL"],
  ["+32", "BE"],
  ["+41", "CH"],
  ["+43", "AT"],
  ["+353", "IE"],
  ["+351", "PT"],
  ["+46", "SE"],
  ["+47", "NO"],
  ["+45", "DK"],
  ["+358", "FI"],
  ["+48", "PL"],
  ["+420", "CZ"],
  ["+91", "IN"],
  ["+86", "CN"],
  ["+81", "JP"],
  ["+82", "KR"],
  ["+61", "AU"],
  ["+64", "NZ"],
  ["+52", "MX"],
  ["+55", "BR"],
  ["+54", "AR"],
  ["+27", "ZA"]
];

/**
 * Infer ISO country from E.164 phone (pool rows or legacy docs without `country`).
 * @param {string} phoneNumber
 * @returns {string|null}
 */
export function inferCountryIsoFromE164(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== "string") return null;
  const p = phoneNumber.trim();
  if (!p.startsWith("+")) return null;

  for (const [prefix, iso] of PREFIX_TO_ISO) {
    if (p.startsWith(prefix)) return iso;
  }

  if (p.startsWith("+1")) {
    const digits = p.replace(/\D/g, "");
    const nsn = digits.length >= 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (nsn.length < 10) return null;
    const ac = nsn.slice(0, 3);
    return CA_AREA_CODES.has(ac) ? "CA" : "US";
  }

  return null;
}

/** Region bucket for pool fallback (not strictly geographic continents). */
const REGION_BY_ISO = {
  US: "NorthAmerica",
  CA: "NorthAmerica",
  MX: "NorthAmerica",
  AE: "MiddleEast",
  SA: "MiddleEast",
  KW: "MiddleEast",
  QA: "MiddleEast",
  BH: "MiddleEast",
  OM: "MiddleEast",
  YE: "MiddleEast",
  IQ: "MiddleEast",
  JO: "MiddleEast",
  LB: "MiddleEast",
  SY: "MiddleEast",
  IR: "MiddleEast",
  IL: "MiddleEast",
  EG: "MiddleEast",
  GB: "Europe",
  FR: "Europe",
  DE: "Europe",
  ES: "Europe",
  IT: "Europe",
  NL: "Europe",
  BE: "Europe",
  CH: "Europe",
  AT: "Europe",
  IE: "Europe",
  PT: "Europe",
  SE: "Europe",
  NO: "Europe",
  DK: "Europe",
  FI: "Europe",
  PL: "Europe",
  CZ: "Europe",
  IN: "AsiaPacific",
  CN: "AsiaPacific",
  JP: "AsiaPacific",
  KR: "AsiaPacific",
  AU: "AsiaPacific",
  NZ: "AsiaPacific",
  BR: "SouthAmerica",
  AR: "SouthAmerica",
  ZA: "Africa"
};

/**
 * @param {string} iso — ISO 3166-1 alpha-2
 * @returns {string}
 */
export function regionForCountry(iso) {
  if (!iso || typeof iso !== "string") return "Unknown";
  const u = iso.trim().toUpperCase();
  return REGION_BY_ISO[u] || "Unknown";
}

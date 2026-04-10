/**
 * BOO-85A — ElevenLabs dynamic variables: location strings must never be null/undefined
 * (ElevenLabs interpolates the literal "null" into the agent prompt).
 * BOO-95A — accept state/region (legacy imports), Google formattedLine, and infer city from formatted line.
 */

function safeStr(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s === "undefined" || s === "null") return "";
  return s;
}

function regionFromAddressObject(nested) {
  if (!nested || typeof nested !== "object") return "";
  return (
    safeStr(nested.province) ||
    safeStr(nested.state) ||
    safeStr(nested.region)
  );
}

/**
 * Best-effort city from a Google-style single-line address (e.g. "…, Ottawa, ON …").
 * @param {string} line
 * @returns {string}
 */
function cityFromFormattedLine(line) {
  const s = safeStr(line);
  if (!s) return "";
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  return "";
}

function formatAddressObject(nested) {
  if (!nested || typeof nested !== "object") return "";
  const { street, city, postalCode, country, formattedLine } = nested;
  const region = regionFromAddressObject(nested);
  const line = [street, city, region, postalCode, country].map(safeStr).filter(Boolean).join(", ");
  if (line) return line;
  return safeStr(formattedLine);
}

/**
 * City for voice: prefer root `city`, then nested profile address city.
 * @param {object|null|undefined} business - lean Business doc
 * @returns {string}
 */
export function resolveBusinessCity(business) {
  if (!business) return "";
  const fromRoot = safeStr(business.city);
  if (fromRoot) return fromRoot;
  const fromProfile = safeStr(business.businessProfile?.address?.city);
  if (fromProfile) return fromProfile;
  if (business.address && typeof business.address === "object") {
    const c = safeStr(business.address.city);
    if (c) return c;
  }
  const fromFmtProfile = cityFromFormattedLine(business.businessProfile?.address?.formattedLine);
  if (fromFmtProfile) return fromFmtProfile;
  if (business.address && typeof business.address === "object") {
    const fromFmtLegacy = cityFromFormattedLine(business.address.formattedLine);
    if (fromFmtLegacy) return fromFmtLegacy;
  }
  return "";
}

/**
 * Single-line postal address for spoken / template use.
 * @param {object|null|undefined} business - lean Business doc
 * @returns {string}
 */
export function formatBusinessAddress(business) {
  if (!business) return "";
  if (typeof business.address === "string") {
    return safeStr(business.address);
  }
  const nested = business.businessProfile?.address;
  if (nested && typeof nested === "object") {
    const line = formatAddressObject(nested);
    if (line) return line;
  }
  if (business.address && typeof business.address === "object") {
    return formatAddressObject(business.address);
  }
  return "";
}

/**
 * @param {object|null|undefined} business
 * @returns {{ business_city: string, business_address: string }}
 */
export function getElevenLabsBusinessLocationVars(business) {
  return {
    business_city: resolveBusinessCity(business),
    business_address: formatBusinessAddress(business)
  };
}

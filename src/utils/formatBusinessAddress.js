/**
 * BOO-85A — ElevenLabs dynamic variables: location strings must never be null/undefined
 * (ElevenLabs interpolates the literal "null" into the agent prompt).
 */

function safeStr(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s === "undefined" || s === "null") return "";
  return s;
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
    return safeStr(business.address.city);
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
    const { street, city, province, postalCode, country } = nested;
    return [street, city, province, postalCode, country].map(safeStr).filter(Boolean).join(", ");
  }
  if (business.address && typeof business.address === "object") {
    const { street, city, province, postalCode, country } = business.address;
    return [street, city, province, postalCode, country].map(safeStr).filter(Boolean).join(", ");
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

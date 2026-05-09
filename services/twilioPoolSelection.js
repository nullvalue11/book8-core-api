/**
 * BOO-TWILIO-UAE-NUMBERS-1A — pick an available pool row by business country (ISO),
 * then continent/region, then any available number (last resort).
 */
import { inferCountryIsoFromE164, regionForCountry } from "../src/utils/countryCodes.js";

/**
 * @param {object} doc — TwilioNumber lean doc
 * @returns {string}
 */
export function resolveTwilioPoolDocCountry(doc) {
  if (doc?.country && typeof doc.country === "string" && /^[A-Za-z]{2}$/.test(doc.country.trim())) {
    return doc.country.trim().toUpperCase();
  }
  return inferCountryIsoFromE164(doc?.phoneNumber) || "CA";
}

/**
 * @param {object[]} availableDocs — sorted pool candidates (e.g. by createdAt)
 * @param {string} requestedIso — ISO alpha-2
 * @returns {{ doc: object, tier: 'country'|'continent'|'global', assignedIso: string }|null}
 */
export function pickAvailableTwilioNumber(availableDocs, requestedIso) {
  if (!Array.isArray(availableDocs) || availableDocs.length === 0) return null;
  const req = String(requestedIso || "CA")
    .trim()
    .toUpperCase();
  if (req.length !== 2) return null;

  const enriched = availableDocs.map((doc) => ({
    doc,
    iso: resolveTwilioPoolDocCountry(doc)
  }));

  const countryHit = enriched.find((x) => x.iso === req);
  if (countryHit) {
    return { doc: countryHit.doc, tier: "country", assignedIso: countryHit.iso };
  }

  const reqRegion = regionForCountry(req);
  if (reqRegion !== "Unknown") {
    const continentHit = enriched.find((x) => regionForCountry(x.iso) === reqRegion);
    if (continentHit) {
      return { doc: continentHit.doc, tier: "continent", assignedIso: continentHit.iso };
    }
  }

  const globalHit = enriched[0];
  return { doc: globalHit.doc, tier: "global", assignedIso: globalHit.iso };
}

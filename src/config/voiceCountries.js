/**
 * BOO-WIZARD-COUNTRY-BRANCH-1A — where voice (Twilio) answering is allowed.
 */

import { normalizeCountryCode } from "./currencyMap.js";

/** Verified Twilio + regulatory fit */
export const VOICE_ALLOWED_COUNTRIES = new Set(["CA", "US", "GB"]);

/** Verified not workable (e.g. VoIP blocked) */
export const VOICE_BLOCKED_COUNTRIES = new Set(["AE"]);

/**
 * @param {string} [countryCode] - ISO2
 * @returns {boolean}
 */
export function isVoiceAllowed(countryCode) {
  if (!countryCode) return true;
  return VOICE_ALLOWED_COUNTRIES.has(String(countryCode).toUpperCase());
}

/**
 * @param {string} [countryCode]
 * @returns {boolean}
 */
export function isVoiceBlocked(countryCode) {
  if (!countryCode) return false;
  return VOICE_BLOCKED_COUNTRIES.has(String(countryCode).toUpperCase());
}

/**
 * @param {string} [countryCode] - ISO2 or empty for unknown
 * @returns {{ voice: boolean, whatsapp: boolean, sms: boolean }}
 */
export function getAvailableChannels(countryCode) {
  const cc = (countryCode || "").toUpperCase();
  if (VOICE_BLOCKED_COUNTRIES.has(cc)) {
    return { voice: false, whatsapp: true, sms: false };
  }
  if (VOICE_ALLOWED_COUNTRIES.has(cc)) {
    return { voice: true, whatsapp: true, sms: true };
  }
  return { voice: true, whatsapp: true, sms: false };
}

/**
 * @param {string} [countryCode]
 * @returns {string|null}
 */
export function getVoiceBlockedReason(countryCode) {
  if (!countryCode) return null;
  const cc = String(countryCode).trim().toUpperCase();
  if (cc === "AE") return "VoIP restrictions in this region";
  if (cc === "CN") return "Regional service restrictions";
  return null;
}

/**
 * Voice allowed for provisioning when `availableChannels` not yet backfilled.
 * @param {object} [business]
 * @returns {boolean}
 */
export function resolveVoiceAllowedForBusiness(business) {
  if (business?.availableChannels && typeof business.availableChannels.voice === "boolean") {
    return business.availableChannels.voice;
  }
  const raw = business?.country;
  if (raw == null || String(raw).trim() === "") {
    return getAvailableChannels("").voice;
  }
  const s = String(raw).trim();
  const iso = normalizeCountryCode(s) || (s.length === 2 ? s.toUpperCase() : "");
  return getAvailableChannels(iso).voice;
}

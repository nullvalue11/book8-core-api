/**
 * BOO-WIZARD-COUNTRY-BRANCH-1A — normalize wizard / API country → ISO2 for storage.
 */

import { normalizeCountryCode } from "../config/currencyMap.js";
import { getAvailableChannels } from "../config/voiceCountries.js";

/**
 * @param {unknown} rawCountry
 * @returns {string} ISO2
 */
export function resolveCountryIsoForBusiness(rawCountry) {
  const def = (process.env.BOOK8_DEFAULT_BUSINESS_COUNTRY || "CA").trim().toUpperCase();
  if (rawCountry == null || String(rawCountry).trim() === "") return def;
  const s = String(rawCountry).trim();
  const iso = normalizeCountryCode(s);
  if (iso) return iso;
  if (s.length === 2) return s.toUpperCase();
  return def;
}

/**
 * Fields to set on new/updated business from country (creation path).
 * @param {string} countryIso
 * @returns {{ country: string, availableChannels: object, twilioNumberStatus: string }}
 */
export function countryChannelBootstrap(countryIso) {
  const channels = getAvailableChannels(countryIso);
  return {
    country: countryIso,
    availableChannels: channels,
    twilioNumberStatus: channels.voice ? "pending" : "skipped_voice_blocked"
  };
}

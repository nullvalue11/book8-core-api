/**
 * Country / BSP routing for outbound messaging (BOO-INFOBIP-INTEGRATE-1A).
 */

export const BSP_BY_COUNTRY = {
  "United States": "twilio",
  Canada: "twilio",
  "United Kingdom": "twilio",
  Australia: "twilio",
  "New Zealand": "twilio",
  Ireland: "twilio",

  "United Arab Emirates": "infobip",
  "Saudi Arabia": "infobip",
  Qatar: "infobip",
  Kuwait: "infobip",
  Bahrain: "infobip",
  Oman: "infobip",
  Egypt: "infobip",
  Jordan: "infobip"
};

const BSP_BY_ISO2 = {
  US: "twilio",
  CA: "twilio",
  GB: "twilio",
  AU: "twilio",
  NZ: "twilio",
  IE: "twilio",

  AE: "infobip",
  SA: "infobip",
  QA: "infobip",
  KW: "infobip",
  BH: "infobip",
  OM: "infobip",
  EG: "infobip",
  JO: "infobip"
};

/**
 * @param {object} business - Business doc (lean or hydrated)
 * @returns {"twilio"|"infobip"}
 */
export function resolveMessagingBackend(business) {
  const pref = business?.preferredBSP?.trim?.()?.toLowerCase();
  if (pref === "infobip" || pref === "twilio") return pref;

  const countryRaw =
    (business?.businessProfile?.address?.country &&
      String(business.businessProfile.address.country).trim()) ||
    (business?.country && String(business.country).trim()) ||
    "";

  if (countryRaw && Object.prototype.hasOwnProperty.call(BSP_BY_COUNTRY, countryRaw)) {
    return BSP_BY_COUNTRY[countryRaw];
  }

  if (countryRaw.length === 2) {
    const iso = countryRaw.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(BSP_BY_ISO2, iso)) {
      return BSP_BY_ISO2[iso];
    }
  }

  return "twilio";
}

/** Map booking language tags to Infobip / WhatsApp template language codes. */
export function infobipLanguageCode(lang) {
  if (!lang || typeof lang !== "string") return "en";
  const base = lang.split(/[-_]/)[0].toLowerCase();
  if (["en", "ar", "fr", "es"].includes(base)) return base;
  return "en";
}

/**
 * @param {object} business
 * @param {string} [customerPhone] - if missing, false
 * @returns {boolean}
 */
export function canSendTransactionalMessage(business, customerPhone) {
  if (!customerPhone) return false;
  const backend = resolveMessagingBackend(business || {});
  if (backend === "twilio") {
    return !!business?.assignedTwilioNumber;
  }
  return !!(
    business?.whatsappSenderNumber?.trim() ||
    process.env.INFOBIP_TEST_SENDER?.trim()
  );
}

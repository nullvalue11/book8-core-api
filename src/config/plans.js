/**
 * Book8 plan definitions — source of truth for API enforcement and dashboard UI.
 */

export const PLANS = {
  starter: {
    name: "Starter",
    price: 29,
    features: {
      maxBusinesses: 1,
      maxServices: 3,
      bookingChannels: ["web"],
      calendarProviders: ["google"],
      multilingual: false,
      maxLanguages: 1,
      smsConfirmations: false,
      emailConfirmations: true,
      aiPhoneAgent: false,
      analytics: "basic",
      maxCallMinutes: 0,
      teamMembers: 1,
      /** BOO-44A: staff/providers; Starter = single operator only */
      maxProviders: 0,
      apiAccess: false,
      customVoice: false,
      whiteLabel: false,
      prioritySupport: false,
      /** BOO-45A */
      noShowProtection: false,
      /** BOO-57A: gallery photos on booking page */
      maxPortfolioPhotos: 5
    }
  },
  growth: {
    name: "Growth",
    price: 99,
    features: {
      maxBusinesses: 5,
      maxServices: 20,
      bookingChannels: ["web", "voice", "sms"],
      calendarProviders: ["google", "outlook"],
      multilingual: true,
      maxLanguages: 70,
      smsConfirmations: true,
      emailConfirmations: true,
      aiPhoneAgent: true,
      analytics: "full",
      maxCallMinutes: 200,
      teamMembers: 3,
      /** BOO-44A: up to 5 staff/providers */
      maxProviders: 5,
      apiAccess: false,
      customVoice: false,
      whiteLabel: false,
      prioritySupport: true,
      noShowProtection: true,
      maxPortfolioPhotos: 20
    }
  },
  enterprise: {
    name: "Enterprise",
    price: 299,
    features: {
      maxBusinesses: -1,
      maxServices: -1,
      bookingChannels: ["web", "voice", "sms"],
      calendarProviders: ["google", "outlook"],
      multilingual: true,
      maxLanguages: 70,
      smsConfirmations: true,
      emailConfirmations: true,
      aiPhoneAgent: true,
      analytics: "full",
      maxCallMinutes: -1,
      teamMembers: -1,
      maxProviders: -1,
      apiAccess: true,
      customVoice: true,
      whiteLabel: true,
      prioritySupport: true,
      noShowProtection: true,
      maxPortfolioPhotos: 50
    }
  }
};

const PLAN_KEYS = new Set(["starter", "growth", "enterprise"]);

/**
 * @param {string} [plan]
 * @returns {object} features map for the plan (defaults to starter)
 */
export function getPlanFeatures(plan) {
  const key = typeof plan === "string" ? plan.toLowerCase() : "";
  if (PLAN_KEYS.has(key)) {
    return PLANS[key].features;
  }
  return PLANS.starter.features;
}

/**
 * @param {string} plan
 * @param {string} feature - key on the features object
 * @returns {boolean|number|string|unknown}
 */
export function isFeatureAllowed(plan, feature) {
  if (feature === "outlookCalendar") {
    return isCalendarProviderAllowed(plan, "outlook");
  }
  const features = getPlanFeatures(plan);
  const v = features[feature];
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (feature === "maxCallMinutes" || feature === "maxLanguages") return v !== 0;
    return v === -1 || v > 0;
  }
  if (Array.isArray(v)) return v.length > 0;
  return v;
}

/**
 * @param {string} plan
 * @param {string} channel - 'web' | 'voice' | 'sms'
 */
export function isChannelAllowed(plan, channel) {
  const features = getPlanFeatures(plan);
  const ch = (channel || "").toLowerCase();
  return Array.isArray(features.bookingChannels) && features.bookingChannels.includes(ch);
}

/**
 * @param {string} plan
 * @param {string} provider - 'google' | 'outlook' (microsoft normalizes to outlook)
 */
export function isCalendarProviderAllowed(plan, provider) {
  const features = getPlanFeatures(plan);
  let p = (provider || "").toLowerCase();
  if (p === "microsoft") p = "outlook";
  return (
    Array.isArray(features.calendarProviders) &&
    features.calendarProviders.map((x) => String(x).toLowerCase()).includes(p)
  );
}

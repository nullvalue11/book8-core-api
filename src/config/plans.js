/**
 * Book8 plan definitions — source of truth for API enforcement and dashboard UI.
 */

import { getCurrencyForBusiness } from "./currencyMap.js";

export const PLANS = {
  /** BOO-76A: new locations until Stripe checkout completes — no live booking channels */
  none: {
    name: "Pending subscription",
    price: 0,
    features: {
      maxBusinesses: 1,
      maxServices: -1,
      bookingChannels: [],
      calendarProviders: ["google"],
      multilingual: false,
      maxLanguages: 1,
      smsConfirmations: false,
      emailConfirmations: true,
      aiPhoneAgent: false,
      analytics: "basic",
      maxCallMinutes: 0,
      teamMembers: 1,
      maxProviders: 0,
      apiAccess: false,
      customVoice: false,
      whiteLabel: false,
      prioritySupport: false,
      noShowProtection: false,
      maxPortfolioPhotos: 5,
      reviewRequests: false,
      waitlist: false,
      maxWaitlistEntries: 0,
      recurringBookings: false,
      maxRecurringOccurrencesPerSeries: 0,
      multiLocationAggregate: false
    }
  },
  starter: {
    name: "Starter",
    price: 29,
    billing: {
      /** Smallest currency unit (cents / fils); must match Stripe Price amounts */
      amounts: { cad: 2900, usd: 1900, aed: 7000 },
      defaultCurrency: "cad"
    },
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
      maxPortfolioPhotos: 5,
      /** BOO-58A: automatic post-appointment review SMS/email */
      reviewRequests: false,
      /** BOO-59A: waitlist when no slots */
      waitlist: false,
      maxWaitlistEntries: 0,
      /** BOO-60A */
      recurringBookings: false,
      maxRecurringOccurrencesPerSeries: 0,
      multiLocationAggregate: false
    }
  },
  growth: {
    name: "Growth",
    price: 99,
    billing: {
      amounts: { cad: 9900, usd: 6900, aed: 25000 },
      defaultCurrency: "cad"
    },
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
      maxPortfolioPhotos: 20,
      reviewRequests: true,
      waitlist: true,
      maxWaitlistEntries: 50,
      recurringBookings: true,
      maxRecurringOccurrencesPerSeries: 12,
      multiLocationAggregate: false
    }
  },
  enterprise: {
    name: "Enterprise",
    price: 299,
    billing: {
      amounts: { cad: 29900, usd: 19900, aed: 73000 },
      defaultCurrency: "cad"
    },
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
      maxPortfolioPhotos: 50,
      reviewRequests: true,
      waitlist: true,
      maxWaitlistEntries: -1,
      recurringBookings: true,
      maxRecurringOccurrencesPerSeries: -1,
      multiLocationAggregate: true
    }
  }
};

const PLAN_KEYS = new Set(["none", "starter", "growth", "enterprise"]);

const PAID_PLAN_KEYS = ["starter", "growth", "enterprise"];

const PRICING_DISPLAY_SYMBOL = {
  cad: "CA$",
  usd: "$",
  aed: "AED"
};

function envFirst(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

/**
 * BOO-MULTI-CURRENCY-FIX-1A: home currency is CAD; the legacy no-suffix env vars
 * (STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, STRIPE_PRICE_ENTERPRISE) hold the
 * CAD Price IDs in production today, so they fall back to `cad`, not `usd`.
 */
function stripePriceIdsForPlan(planName) {
  switch (planName) {
    case "starter":
      return {
        cad: envFirst(["STRIPE_PRICE_STARTER_CAD", "STRIPE_PRICE_STARTER"]),
        usd: envFirst(["STRIPE_PRICE_STARTER_USD"]),
        aed: envFirst(["STRIPE_PRICE_STARTER_AED"])
      };
    case "growth":
      return {
        cad: envFirst(["STRIPE_PRICE_GROWTH_CAD", "STRIPE_PRICE_GROWTH"]),
        usd: envFirst(["STRIPE_PRICE_GROWTH_USD"]),
        aed: envFirst(["STRIPE_PRICE_GROWTH_AED"])
      };
    case "enterprise":
      return {
        cad: envFirst(["STRIPE_PRICE_ENTERPRISE_CAD", "STRIPE_PRICE_ENTERPRISE"]),
        usd: envFirst(["STRIPE_PRICE_ENTERPRISE_USD"]),
        aed: envFirst(["STRIPE_PRICE_ENTERPRISE_AED"])
      };
    default:
      return null;
  }
}

/**
 * @param {string} planName - starter | growth | enterprise
 * @param {string} currency - lowercase Stripe currency (e.g. usd, aed)
 * @returns {string} Stripe Price ID
 */
export function getPriceIdForPlan(planName, currency) {
  const plan = PLANS[planName];
  if (!plan?.billing) {
    throw new Error(`Unknown plan: ${planName}`);
  }
  const priceIds = stripePriceIdsForPlan(planName);
  if (!priceIds) {
    throw new Error(`Unknown plan: ${planName}`);
  }
  const { defaultCurrency } = plan.billing;
  const cur = (currency || "").toLowerCase();
  const id = priceIds[cur] || priceIds[defaultCurrency];
  if (!id) {
    throw new Error(`No Stripe price ID for plan ${planName} (${cur})`);
  }
  return id;
}

/**
 * Stripe Checkout / subscription session: currency + Price ID from business + plan.
 * @param {object} business
 * @param {string} planName
 * @returns {{ currency: string, priceId: string }}
 */
export function resolveSubscriptionPriceForBusiness(business, planName) {
  const currency = getCurrencyForBusiness(business);
  const priceId = getPriceIdForPlan(planName, currency);
  return { currency, priceId };
}

/**
 * Public pricing for onboarding UI (amounts in major units).
 * @param {string} currency - resolved lowercase currency
 * @returns {Record<string, { amount: number, currency: string, displaySymbol: string }>}
 */
export function getPlansPricingByCurrency(currency) {
  const requested = (currency || "usd").toLowerCase();
  const out = {};
  for (const key of PAID_PLAN_KEYS) {
    const billing = PLANS[key].billing;
    const has = billing.amounts[requested] != null;
    const eff = has ? requested : billing.defaultCurrency;
    const minor = billing.amounts[eff];
    out[key] = {
      amount: minor / 100,
      currency: eff,
      displaySymbol: PRICING_DISPLAY_SYMBOL[eff] || eff.toUpperCase()
    };
  }
  return out;
}

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

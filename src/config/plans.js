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
      /** Minor units (Stripe); must match Price amounts */
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

const CHECKOUT_CURRENCIES = new Set(["cad", "usd", "aed"]);
const DEFAULT_CHECKOUT_CURRENCY = "cad";

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

/** Pre-fix USD prices ($29/$99/$299) — webhook reverse lookup only; never used for new checkout. */
function legacyUsdStripePriceIdsForPlan(planName) {
  switch (planName) {
    case "starter":
      return envFirst(["STRIPE_PRICE_LEGACY_STARTER_USD"]);
    case "growth":
      return envFirst(["STRIPE_PRICE_LEGACY_GROWTH_USD"]);
    case "enterprise":
      return envFirst(["STRIPE_PRICE_LEGACY_ENTERPRISE_USD"]);
    default:
      return "";
  }
}

/**
 * BOO-MULTI-CURRENCY-FIX-1A: strict checkout currency; CAD is base when absent/invalid.
 * @param {unknown} currency
 * @returns {"cad"|"usd"|"aed"}
 */
export function normalizeCheckoutCurrency(currency) {
  const cur = typeof currency === "string" ? currency.trim().toLowerCase() : "";
  return CHECKOUT_CURRENCIES.has(cur) ? cur : DEFAULT_CHECKOUT_CURRENCY;
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
 * Reverse lookup: Stripe Price ID → plan key (starter | growth | enterprise).
 * Uses configured STRIPE_PRICE_* env vars; falls back to billing minor-unit amounts.
 * @param {string} priceId
 * @returns {string|null}
 */
export function getPlanForPriceId(priceId) {
  const id = priceId != null ? String(priceId).trim() : "";
  if (!id) return null;

  for (const planName of PAID_PLAN_KEYS) {
    const ids = stripePriceIdsForPlan(planName);
    if (ids) {
      for (const val of Object.values(ids)) {
        if (val && val === id) return planName;
      }
    }
    const legacyUsd = legacyUsdStripePriceIdsForPlan(planName);
    if (legacyUsd && legacyUsd === id) return planName;
  }

  return null;
}

/**
 * All configured + legacy Stripe Price IDs → plan tier (for ops / 1B handoff).
 * @returns {Record<string, string>}
 */
export function buildPriceIdToPlanMap() {
  const map = {};
  for (const planName of PAID_PLAN_KEYS) {
    const ids = stripePriceIdsForPlan(planName);
    if (ids) {
      for (const [currency, priceId] of Object.entries(ids)) {
        if (priceId) map[priceId] = planName;
      }
    }
    const legacyUsd = legacyUsdStripePriceIdsForPlan(planName);
    if (legacyUsd) map[legacyUsd] = planName;
  }
  return map;
}

/**
 * Resolve plan from a Stripe Price object (id, unit_amount, metadata.plan).
 * @param {import("stripe").Stripe.Price | null | undefined} price
 * @returns {string|null}
 */
export function resolvePlanFromStripePrice(price) {
  if (!price) return null;

  const fromId = getPlanForPriceId(price.id);
  if (fromId) return fromId;

  const metaPlan =
    typeof price.metadata?.plan === "string" ? price.metadata.plan.trim().toLowerCase() : "";
  if (PLAN_KEYS.has(metaPlan) && metaPlan !== "none") return metaPlan;

  const amount = typeof price.unit_amount === "number" ? price.unit_amount : null;
  if (amount != null) {
    for (const planName of PAID_PLAN_KEYS) {
      const billing = PLANS[planName].billing;
      if (!billing?.amounts) continue;
      for (const minor of Object.values(billing.amounts)) {
        if (minor === amount) return planName;
      }
    }
  }

  return null;
}

/**
 * @param {import("stripe").Stripe.Subscription | null | undefined} subscription
 * @returns {string|null}
 */
export function resolvePlanFromStripeSubscription(subscription) {
  if (!subscription) return null;

  const metaPlan =
    typeof subscription.metadata?.plan === "string"
      ? subscription.metadata.plan.trim().toLowerCase()
      : "";
  if (PLAN_KEYS.has(metaPlan) && metaPlan !== "none") return metaPlan;

  const item = subscription.items?.data?.[0];
  return resolvePlanFromStripePrice(item?.price);
}

/**
 * @param {import("stripe").Stripe.Subscription | null | undefined} subscription
 * @returns {string|null} lowercase currency (cad | usd | aed)
 */
export function resolveCurrencyFromStripeSubscription(subscription) {
  if (!subscription) return null;
  const item = subscription.items?.data?.[0];
  const cur =
    typeof item?.price?.currency === "string" ? item.price.currency.trim().toLowerCase() : "";
  return CHECKOUT_CURRENCIES.has(cur) ? cur : null;
}

/**
 * Stripe Checkout / subscription session: currency + Price ID from business + plan.
 * @param {object} business
 * @param {string} planName
 * @returns {{ currency: string, priceId: string }}
 */
export function resolveSubscriptionPriceForBusiness(business, planName, currencyOverride) {
  const currency = currencyOverride
    ? normalizeCheckoutCurrency(currencyOverride)
    : getCurrencyForBusiness(business);
  const priceId = getPriceIdForPlan(planName, currency);
  return { currency, priceId };
}

/**
 * Checkout price resolution for book8-ai (tier + currency only — never trust amounts).
 * @param {string} planName
 * @param {unknown} [currency]
 * @returns {{ plan: string, currency: string, priceId: string }}
 */
export function resolveCheckoutPrice(planName, currency) {
  const plan = typeof planName === "string" ? planName.trim().toLowerCase() : "";
  if (!PAID_PLAN_KEYS.includes(plan)) {
    throw new Error(`Unknown plan: ${planName}`);
  }
  const cur = normalizeCheckoutCurrency(currency);
  const priceId = getPriceIdForPlan(plan, cur);
  return { plan, currency: cur, priceId };
}

/**
 * Public pricing for onboarding UI — amounts are Stripe minor units (cents / fils / cents CAD).
 * @param {string} currency - resolved lowercase currency (cad | usd | aed)
 * @returns {Record<string, { amount: number, currency: string, displaySymbol: string }>}
 */
export function getPlansPricingByCurrency(currency) {
  const cur = (currency || "usd").toLowerCase();
  const out = {};
  for (const key of PAID_PLAN_KEYS) {
    const billing = PLANS[key].billing;
    let effCurrency = cur;
    let minor = billing.amounts[cur];
    if (minor == null) {
      effCurrency = billing.defaultCurrency;
      minor = billing.amounts[effCurrency];
    }
    out[key] = {
      amount: minor,
      currency: effCurrency,
      displaySymbol: PRICING_DISPLAY_SYMBOL[effCurrency] || effCurrency.toUpperCase()
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

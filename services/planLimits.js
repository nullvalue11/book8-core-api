/**
 * Legacy plan limits shape for existing API responses (GET business, GET plan, service caps).
 * Backed by src/config/plans.js.
 */

import {
  PLANS,
  getPlanFeatures,
  isChannelAllowed,
  isCalendarProviderAllowed
} from "../src/config/plans.js";

export { PLANS, getPlanFeatures, isChannelAllowed, isCalendarProviderAllowed };

/**
 * @returns {object} shape expected by index.js and dashboards
 */
export function getPlanLimits(plan) {
  const f = getPlanFeatures(plan);
  return {
    aiPhoneAgent: !!f.aiPhoneAgent,
    maxServices: typeof f.maxServices === "number" ? f.maxServices : 3,
    maxTeamMembers: f.teamMembers,
    smsReminders: !!f.smsConfirmations,
    emailReminders: !!f.emailConfirmations,
    googleCalendarSync:
      Array.isArray(f.calendarProviders) && f.calendarProviders.includes("google"),
    outlookCalendarSync:
      Array.isArray(f.calendarProviders) && f.calendarProviders.includes("outlook"),
    advancedAnalytics: f.analytics === "full",
    apiAccess: !!f.apiAccess,
    whiteLabel: !!f.whiteLabel,
    callMinuteRate: 0.1,
    publicBookingPage: true,
    maxProviders: typeof f.maxProviders === "number" ? f.maxProviders : 0,
    noShowProtection: !!f.noShowProtection,
    maxPortfolioPhotos: typeof f.maxPortfolioPhotos === "number" ? f.maxPortfolioPhotos : 5,
    reviewRequests: !!f.reviewRequests,
    waitlist: !!f.waitlist,
    maxWaitlistEntries:
      typeof f.maxWaitlistEntries === "number" ? f.maxWaitlistEntries : 0,
    recurringBookings: !!f.recurringBookings,
    maxRecurringOccurrencesPerSeries:
      typeof f.maxRecurringOccurrencesPerSeries === "number"
        ? f.maxRecurringOccurrencesPerSeries
        : 0
  };
}

/**
 * Boolean-style check for feature flags (and numeric/array truthiness where useful).
 * @param {string} plan
 * @param {string} feature - key in plan features or legacy limit key
 */
export function isFeatureAllowed(plan, feature) {
  const f = getPlanFeatures(plan);
  if (Object.prototype.hasOwnProperty.call(f, feature)) {
    const v = f[feature];
    if (typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (feature === "maxCallMinutes" || feature === "maxLanguages") return v !== 0;
      return v === -1 || v > 0;
    }
    if (Array.isArray(v)) return v.length > 0;
    return !!v;
  }
  const limits = getPlanLimits(plan);
  if (Object.prototype.hasOwnProperty.call(limits, feature)) {
    return !!limits[feature];
  }
  return false;
}

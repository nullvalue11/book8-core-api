export const PLAN_LIMITS = {
  starter: {
    aiPhoneAgent: false,
    maxServices: 3,
    maxTeamMembers: 1,
    smsReminders: true,
    emailReminders: true,
    googleCalendarSync: true,
    advancedAnalytics: false,
    apiAccess: false,
    whiteLabel: false,
    callMinuteRate: 0.1,
    publicBookingPage: true
  },
  growth: {
    aiPhoneAgent: true,
    maxServices: 20,
    maxTeamMembers: 5,
    smsReminders: true,
    emailReminders: true,
    googleCalendarSync: true,
    advancedAnalytics: true,
    apiAccess: false,
    whiteLabel: false,
    callMinuteRate: 0.1,
    publicBookingPage: true
  },
  enterprise: {
    aiPhoneAgent: true,
    maxServices: -1, // unlimited
    maxTeamMembers: -1, // unlimited
    smsReminders: true,
    emailReminders: true,
    googleCalendarSync: true,
    advancedAnalytics: true,
    apiAccess: true,
    whiteLabel: true,
    callMinuteRate: 0.1,
    publicBookingPage: true
  }
};

export function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
}

export function isFeatureAllowed(plan, feature) {
  const limits = getPlanLimits(plan);
  return !!limits[feature];
}


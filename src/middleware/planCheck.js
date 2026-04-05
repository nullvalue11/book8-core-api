import { Business } from "../../models/Business.js";
import { isFeatureAllowed, isChannelAllowed } from "../config/plans.js";

/** Minimum plan tier that unlocks each feature (403 `requiredPlan` must match this, not a constant). */
export const FEATURE_PLAN_MAP = {
  aiPhoneAgent: "growth",
  smsConfirmations: "growth",
  voiceBooking: "growth",
  outlookCalendar: "growth",
  multilingual: "growth",
  noShowProtection: "growth",
  reviewRequests: "growth",
  waitlist: "growth",
  recurringBookings: "growth",
  customVoice: "enterprise",
  whiteLabel: "enterprise",
  apiAccess: "enterprise"
};

export function requiredPlanForFeature(featureName) {
  return FEATURE_PLAN_MAP[featureName] || "growth";
}

/**
 * Require a plan feature (e.g. aiPhoneAgent).
 * @param {string} featureName - key on plan features
 */
export function requireFeature(featureName) {
  return async (req, res, next) => {
    const businessId =
      req.params.businessId ||
      req.params.id ||
      req.body?.businessId ||
      req.body?.input?.businessId;

    if (!businessId) {
      return res.status(400).json({ ok: false, error: "businessId is required" });
    }

    try {
      const business = await Business.findOne({
        $or: [{ id: businessId }, { businessId }]
      }).lean();

      if (!business) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      const plan = business.plan || "starter";
      const allowed = isFeatureAllowed(plan, featureName);

      if (!allowed) {
        return res.status(403).json({
          ok: false,
          error: "This feature requires a higher plan.",
          feature: featureName,
          currentPlan: plan,
          requiredPlan: requiredPlanForFeature(featureName),
          upgrade: true
        });
      }

      req.businessPlan = plan;
      next();
    } catch (err) {
      console.error("[planCheck] Error checking plan:", err.message);
      return res.status(500).json({ ok: false, error: "Plan verification failed" });
    }
  };
}

/**
 * Require a booking channel (web | voice | sms).
 * @param {string} channel
 */
export function requireChannel(channel) {
  return async (req, res, next) => {
    const businessId =
      req.params.businessId || req.body?.businessId || req.body?.input?.businessId;

    if (!businessId) {
      return res.status(400).json({ ok: false, error: "businessId is required" });
    }

    try {
      const business = await Business.findOne({
        $or: [{ id: businessId }, { businessId }]
      }).lean();

      if (!business) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      const plan = business.plan || "starter";

      if (!isChannelAllowed(plan, channel)) {
        return res.status(403).json({
          ok: false,
          error: `${channel} booking is not available on the ${plan} plan.`,
          currentPlan: plan,
          upgrade: true
        });
      }

      req.businessPlan = plan;
      next();
    } catch (err) {
      console.error("[planCheck] Error checking plan:", err.message);
      return res.status(500).json({ ok: false, error: "Plan verification failed" });
    }
  };
}

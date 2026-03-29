import { Business } from "../../models/Business.js";
import { isFeatureAllowed, isChannelAllowed } from "../config/plans.js";

/**
 * Require a plan feature (e.g. aiPhoneAgent). Skips check if businessId is missing.
 * @param {string} featureName - key on plan features
 */
export function requireFeature(featureName) {
  return async (req, res, next) => {
    const businessId =
      req.params.businessId ||
      req.body?.businessId ||
      req.body?.input?.businessId;

    if (!businessId) {
      return next();
    }

    try {
      const business = await Business.findOne({
        $or: [{ id: businessId }, { businessId }]
      }).lean();

      if (!business) {
        return next();
      }

      const plan = business.plan || "starter";
      const allowed = isFeatureAllowed(plan, featureName);

      if (!allowed) {
        return res.status(403).json({
          ok: false,
          error: "This feature requires a higher plan.",
          feature: featureName,
          currentPlan: plan,
          requiredPlan: "growth",
          upgrade: true
        });
      }

      req.businessPlan = plan;
      next();
    } catch (err) {
      console.error("[planCheck] Error:", err);
      next();
    }
  };
}

/**
 * Require a booking channel (web | voice | sms).
 * @param {string} channel
 */
export function requireChannel(channel) {
  return async (req, res, next) => {
    const businessId = req.params.businessId || req.body?.businessId;

    if (!businessId) {
      return next();
    }

    try {
      const business = await Business.findOne({
        $or: [{ id: businessId }, { businessId }]
      }).lean();

      if (!business) {
        return next();
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
      next();
    }
  };
}

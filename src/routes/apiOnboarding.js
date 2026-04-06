// BOO-63A — /api/resolve, /api/onboard, /api/provision (moved from index.js)
import express from "express";
import { Business } from "../../models/Business.js";
import { classifyBusinessCategory } from "../../services/categoryClassifier.js";
import { getDefaultServices, getDefaultWeeklySchedule } from "../../services/bootstrapDefaults.js";
import { ensureBookableDefaultsForBusiness } from "../../services/bookableBootstrap.js";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import { generateUniquePublicSlug, normalizePhoneNumber } from "../utils/businessRouteHelpers.js";

export default function createApiOnboardingRouter({ requireApiKey }) {
  const router = express.Router();

  router.get("/resolve", strictLimiter, requireInternalAuth, async (req, res) => {
    try {
      const { to } = req.query;

      if (!to) {
        return res.status(400).json({
          ok: false,
          error: "Missing 'to' phone number"
        });
      }

      const normalizedTo = normalizePhoneNumber(to);
      if (!normalizedTo) {
        return res.status(400).json({
          ok: false,
          error: "Invalid phone number format"
        });
      }

      const business = await Business.findOne({
        assignedTwilioNumber: normalizedTo
      }).lean();

      if (!business) {
        return res.status(404).json({
          ok: false,
          error: "No business found for this phone number"
        });
      }

      res.json({ ok: true, businessId: business.id });
    } catch (err) {
      console.error("Error in GET /api/resolve:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.post("/onboard", requireApiKey, async (req, res) => {
    try {
      const {
        name,
        description,
        category,
        timezone,
        phoneNumber,
        email,
        greetingOverride,
        services,
        bookingSettings
      } = req.body;

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "Field 'name' is required"
        });
      }

      let finalId;
      try {
        finalId = await generateUniquePublicSlug(name);
      } catch {
        return res.status(400).json({
          ok: false,
          error: "Unable to generate business ID from name"
        });
      }

      let finalCategory = category;
      if (!finalCategory) {
        finalCategory = await classifyBusinessCategory({ name, description });
      }

      const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

      const tz = timezone || "America/Toronto";
      const servicesToUse = Array.isArray(services) && services.length > 0 ? services : getDefaultServices();
      const weeklyScheduleToUse = getDefaultWeeklySchedule(tz);

      const business = new Business({
        id: finalId,
        businessId: finalId,
        handle: finalId,
        name,
        description,
        category: finalCategory,
        timezone: tz,
        phoneNumber: normalizedPhoneNumber,
        email,
        greetingOverride,
        services: servicesToUse,
        bookingSettings,
        weeklySchedule: weeklyScheduleToUse
      });

      await business.save();

      const bootstrap = await ensureBookableDefaultsForBusiness(finalId, { timezone: tz });

      res.json({
        ok: true,
        businessId: finalId,
        business: business.toObject(),
        defaultsEnsured: bootstrap.defaultsEnsured
      });
    } catch (err) {
      console.error("Error in POST /api/onboard:", err);

      if (err.code === 11000) {
        return res.status(400).json({
          ok: false,
          error: "Business with this phone number already exists"
        });
      }

      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.post("/provision", requireApiKey, async (req, res) => {
    try {
      const { name, description, category, timezone, email, phoneNumber, services } = req.body;

      if (!name) {
        return res.status(400).json({
          ok: false,
          error: "Field 'name' is required"
        });
      }

      let finalId;
      try {
        finalId = await generateUniquePublicSlug(name);
      } catch {
        return res.status(400).json({
          ok: false,
          error: "Unable to generate business ID from name"
        });
      }

      let finalCategory = category;
      if (!finalCategory) {
        finalCategory = await classifyBusinessCategory({ name, description });
      }

      const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

      const tz = timezone || "America/Toronto";
      const servicesToUse = Array.isArray(services) && services.length > 0 ? services : getDefaultServices();
      const weeklyScheduleToUse = getDefaultWeeklySchedule(tz);

      const business = new Business({
        id: finalId,
        businessId: finalId,
        handle: finalId,
        name,
        description,
        category: finalCategory,
        timezone: tz,
        phoneNumber: normalizedPhoneNumber,
        email,
        services: servicesToUse,
        weeklySchedule: weeklyScheduleToUse
      });

      await business.save();

      const bootstrap = await ensureBookableDefaultsForBusiness(finalId, { timezone: tz });

      res.json({
        ok: true,
        businessId: finalId,
        business: {
          id: business.id,
          name: business.name,
          category: business.category,
          timezone: business.timezone,
          email: business.email
        },
        defaultsEnsured: bootstrap.defaultsEnsured,
        nextSteps: {
          connectNumber: {
            endpoint: `/api/businesses/${finalId}/assign-number`,
            method: "POST",
            description: "Connect your Twilio phone number to start receiving calls",
            example: {
              assignedTwilioNumber: "+16471234567"
            }
          },
          updateProfile: {
            endpoint: `/api/businesses`,
            method: "POST",
            description: "Update business details, services, and settings"
          }
        }
      });
    } catch (err) {
      console.error("Error in POST /api/provision:", err);

      if (err.code === 11000) {
        return res.status(400).json({
          ok: false,
          error: "Business with this phone number already exists"
        });
      }

      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  return router;
}

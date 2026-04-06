// BOO-63A — /api/businesses/* routes previously inline in index.js (behavior unchanged)
import express from "express";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { Schedule } from "../../models/Schedule.js";
import {
  buildPublicBusinessProfile,
  mergeBusinessProfile,
  validateBusinessProfileMerged
} from "../utils/businessProfile.js";
import { getPlanLimits, isFeatureAllowed } from "../../services/planLimits.js";
import { isInternalCoreApiRequest } from "../middleware/internalAuth.js";
import { toPublicGooglePlaces } from "../utils/googlePlacesPublic.js";
import { toPublicPortfolio } from "../utils/businessPortfolioPublic.js";
import { placeDetails, isGooglePlacesConfigured } from "../../services/googlePlacesApi.js";
import { applyGooglePlacesToBusiness } from "../../services/googlePlacesSync.js";
import {
  findBusinessByParam,
  toPublicBusinessPayload,
  mapNumberSetupMethodForSchema,
  normalizePhoneNumber,
  generateUniquePublicSlug
} from "../utils/businessRouteHelpers.js";
import { classifyBusinessCategory } from "../../services/categoryClassifier.js";

/**
 * @param {object} deps
 * @param {import("express").RequestHandler} deps.requireApiKey
 * @param {import("express").RequestHandler} deps.requireInternalSecretOrApiKey
 * @param {import("express").RequestHandler} deps.requireInternalAuth
 * @param {import("express").RequestHandler} deps.strictLimiter
 * @param {import("express").RequestHandler} deps.handleGetBusinessReviews
 */
export default function createBusinessesHttpRouter(deps) {
  const {
    requireApiKey,
    requireInternalSecretOrApiKey,
    requireInternalAuth,
    strictLimiter,
    handleGetBusinessReviews
  } = deps;

  const router = express.Router();

  router.get("/:id/services", async (req, res) => {
    try {
      const { id } = req.params;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { businessId } = resolved;
      const services = await Service.find({ businessId }).lean();
      res.json({ ok: true, businessId, services });
    } catch (err) {
      console.error("Error in GET /api/businesses/:id/services:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.post("/:id/services", requireApiKey, async (req, res) => {
    try {
      const { id } = req.params;
      const { serviceId, name, durationMinutes, active, price, currency } = req.body;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { business, businessId } = resolved;
      if (!serviceId || !name || durationMinutes == null) {
        return res.status(400).json({
          ok: false,
          error: "serviceId, name, and durationMinutes are required"
        });
      }
      const limits = getPlanLimits(business.plan);
      if (limits.maxServices !== -1) {
        const currentCount = await Service.countDocuments({ businessId });
        if (currentCount >= limits.maxServices) {
          return res.status(403).json({
            ok: false,
            error: `Your ${business.plan || "starter"} plan allows up to ${limits.maxServices} services. Upgrade to add more.`
          });
        }
      }
      const createDoc = {
        businessId,
        serviceId,
        name,
        durationMinutes: Number(durationMinutes),
        active: active !== false
      };
      if (price !== undefined && price !== null && price !== "") {
        const n = Number(price);
        if (!Number.isNaN(n)) createDoc.price = n;
      }
      if (currency !== undefined && currency !== null && String(currency).trim() !== "") {
        createDoc.currency = String(currency).trim().toUpperCase().slice(0, 3);
      }
      const doc = await Service.create(createDoc);
      res.status(201).json({ ok: true, businessId, service: doc.toObject() });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({
          ok: false,
          error: "Service with this serviceId already exists for this business"
        });
      }
      console.error("Error in POST /api/businesses/:id/services:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.put("/:id/services/:serviceId", requireApiKey, async (req, res) => {
    try {
      const { id, serviceId } = req.params;
      const { name, durationMinutes, active, price, currency } = req.body;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { businessId } = resolved;
      const update = {};
      if (name !== undefined) update.name = name;
      if (durationMinutes !== undefined) update.durationMinutes = Number(durationMinutes);
      if (active !== undefined) update.active = !!active;
      if (price !== undefined) {
        if (price === null || price === "") update.price = null;
        else {
          const n = Number(price);
          if (!Number.isNaN(n)) update.price = n;
        }
      }
      if (currency !== undefined) {
        if (currency === null || currency === "") update.currency = "USD";
        else update.currency = String(currency).trim().toUpperCase().slice(0, 3);
      }
      if (Object.keys(update).length === 0) {
        return res.status(400).json({
          ok: false,
          error: "At least one of name, durationMinutes, active, price, or currency is required"
        });
      }
      const service = await Service.findOneAndUpdate(
        { businessId, serviceId },
        { $set: update },
        { new: true }
      ).lean();
      if (!service) {
        return res.status(404).json({ ok: false, error: "Service not found" });
      }
      res.json({ ok: true, businessId, service });
    } catch (err) {
      console.error("Error in PUT /api/businesses/:id/services/:serviceId:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.patch("/:id/services/:serviceId", requireInternalAuth, async (req, res) => {
    try {
      const { id, serviceId } = req.params;
      const { name, durationMinutes, active, price, currency } = req.body || {};
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { businessId } = resolved;
      const update = {};
      if (name !== undefined) update.name = name;
      if (durationMinutes !== undefined) update.durationMinutes = Number(durationMinutes);
      if (active !== undefined) update.active = !!active;
      if (price !== undefined) {
        if (price === null || price === "") update.price = null;
        else {
          const n = Number(price);
          if (!Number.isNaN(n)) update.price = n;
        }
      }
      if (currency !== undefined) {
        if (currency === null || currency === "") update.currency = "USD";
        else update.currency = String(currency).trim().toUpperCase().slice(0, 3);
      }
      if (Object.keys(update).length === 0) {
        return res.status(400).json({
          ok: false,
          error: "At least one of name, durationMinutes, active, price, or currency is required"
        });
      }
      const service = await Service.findOneAndUpdate(
        { businessId, serviceId },
        { $set: update },
        { new: true }
      ).lean();
      if (!service) {
        return res.status(404).json({ ok: false, error: "Service not found" });
      }
      res.json({ ok: true, businessId, service });
    } catch (err) {
      console.error("Error in PATCH /api/businesses/:id/services/:serviceId:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/:id/schedule", async (req, res) => {
    try {
      const { id } = req.params;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { business, businessId } = resolved;
      let schedule = await Schedule.findOne({ businessId }).lean();
      if (!schedule) {
        schedule = {
          businessId,
          timezone: business.timezone || "America/Toronto",
          weeklyHours: business.weeklySchedule?.weeklyHours || {
            monday: [],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
            sunday: []
          }
        };
      }
      res.json({ ok: true, businessId, schedule });
    } catch (err) {
      console.error("Error in GET /api/businesses/:id/schedule:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.put("/:id/schedule", requireApiKey, async (req, res) => {
    try {
      const { id } = req.params;
      const { timezone, weeklyHours } = req.body;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { businessId } = resolved;
      if (!weeklyHours || typeof weeklyHours !== "object") {
        return res.status(400).json({
          ok: false,
          error: "weeklyHours (object) is required"
        });
      }
      const schedule = await Schedule.findOneAndUpdate(
        { businessId },
        {
          $set: {
            timezone: timezone || "America/Toronto",
            weeklyHours
          }
        },
        { new: true, upsert: true }
      ).lean();
      res.json({ ok: true, businessId, schedule });
    } catch (err) {
      console.error("Error in PUT /api/businesses/:id/schedule:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/:id/public", strictLimiter, async (req, res) => {
    try {
      const { id } = req.params;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { business, businessId } = resolved;
      const services = await Service.find({ businessId, active: true }).lean();
      let schedule = await Schedule.findOne({ businessId }).lean();
      if (!schedule) {
        schedule = {
          timezone: business.timezone || "America/Toronto",
          weeklyHours:
            business.weeklySchedule?.weeklyHours || {
              monday: [],
              tuesday: [],
              wednesday: [],
              thursday: [],
              friday: [],
              saturday: [],
              sunday: []
            }
        };
      }
      const publicServices = services.map((s) => ({
        serviceId: s.serviceId,
        name: s.name,
        durationMinutes: s.durationMinutes,
        price: s.price,
        currency: s.currency
      }));
      const publicGooglePlaces = toPublicGooglePlaces(business.googlePlaces);
      const publicPortfolio = toPublicPortfolio(business.portfolio);
      const publicPayload = {
        ok: true,
        businessName: business.name,
        handle: business.handle ?? null,
        timezone: business.timezone || "America/Toronto",
        businessProfile: buildPublicBusinessProfile(business),
        services: publicServices,
        businessHours: {
          timezone: schedule.timezone,
          weeklyHours: schedule.weeklyHours
        }
      };
      if (publicGooglePlaces) {
        publicPayload.googlePlaces = publicGooglePlaces;
      }
      if (publicPortfolio) {
        publicPayload.portfolio = publicPortfolio;
      }
      res.json(publicPayload);
    } catch (err) {
      console.error("Error in GET /api/businesses/:id/public:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.patch("/:id/profile", strictLimiter, requireInternalAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const partial = req.body?.businessProfile;
      if (partial == null || typeof partial !== "object" || Array.isArray(partial)) {
        return res.status(400).json({
          ok: false,
          error: "businessProfile object is required"
        });
      }
      const doc = await Business.findOne({ $or: [{ id }, { businessId: id }] });
      if (!doc) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const merged = mergeBusinessProfile(doc.businessProfile, partial);
      const v = validateBusinessProfileMerged(merged);
      if (!v.ok) {
        return res.status(400).json({ ok: false, error: v.error });
      }
      doc.businessProfile = merged;
      await doc.save();
      res.json({ ok: true, business: doc.toObject() });
    } catch (err) {
      console.error("Error in PATCH /api/businesses/:id/profile:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.post("/:id/sync-google-places", strictLimiter, requireInternalAuth, async (req, res) => {
    try {
      if (!isGooglePlacesConfigured()) {
        return res.status(503).json({ ok: false, error: "Google Places is not configured" });
      }
      const { id } = req.params;
      const placeId = req.body?.placeId;
      if (!placeId || typeof placeId !== "string" || !placeId.trim()) {
        return res.status(400).json({ ok: false, error: "placeId is required" });
      }
      const doc = await Business.findOne({ $or: [{ id }, { businessId: id }] });
      if (!doc) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const r = await placeDetails(placeId.trim());
      if (!r.ok) {
        return res.status(400).json({ ok: false, error: r.error });
      }
      applyGooglePlacesToBusiness(doc, r.place);
      await doc.save();
      return res.json({ ok: true, business: doc.toObject() });
    } catch (err) {
      console.error("Error in POST /api/businesses/:id/sync-google-places:", err);
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/:id/reviews", strictLimiter, handleGetBusinessReviews);

  router.get("/:id", strictLimiter, async (req, res) => {
    try {
      const id = req.params.id;
      const resolved = await findBusinessByParam(id);

      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      const { business } = resolved;

      if (!isInternalCoreApiRequest(req)) {
        return res.json({
          ok: true,
          business: toPublicBusinessPayload(business)
        });
      }

      const limits = getPlanLimits(business.plan);
      res.json({ ok: true, business: { ...business }, planLimits: limits });
    } catch (err) {
      console.error("Error in GET /api/businesses/:id:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.post("/:id", requireInternalSecretOrApiKey, async (req, res) => {
    try {
      const { id } = req.params;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      const {
        name,
        numberSetupMethod,
        forwardingEnabled,
        forwardingFrom,
        phoneNumber,
        phoneSetup,
        existingBusinessNumber
      } = req.body || {};

      const update = {};

      if (typeof name === "string" && name.trim()) {
        const trimmed = name.trim();
        update.name = trimmed;
        const canonicalId = String(resolved.business.id ?? resolved.business.businessId ?? "");
        update.handle = await generateUniquePublicSlug(trimmed, {
          excludingId: canonicalId || undefined
        });
      }

      if (numberSetupMethod !== undefined && numberSetupMethod !== null) {
        const mapped = mapNumberSetupMethodForSchema(numberSetupMethod);
        if (mapped) {
          update.numberSetupMethod = mapped;
        }
      }

      if (typeof forwardingEnabled === "boolean") {
        update.forwardingEnabled = forwardingEnabled;
      }
      if (Array.isArray(forwardingFrom)) {
        update.forwardingFrom = forwardingFrom;
      }

      if (phoneNumber !== undefined) {
        update.phoneNumber =
          phoneNumber === null || phoneNumber === "" ? null : normalizePhoneNumber(phoneNumber);
      }

      if (phoneSetup === "new" || phoneSetup === "forward") {
        update.phoneSetup = phoneSetup;
      }
      if (existingBusinessNumber !== undefined) {
        if (existingBusinessNumber === null) {
          update.existingBusinessNumber = null;
        } else if (typeof existingBusinessNumber === "string") {
          update.existingBusinessNumber = existingBusinessNumber.trim();
        }
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({
          ok: false,
          error: "No valid fields to update"
        });
      }

      const business = await Business.findByIdAndUpdate(
        resolved.business._id,
        { $set: update },
        { new: true, runValidators: true }
      ).lean();

      if (!business) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      const businessId = business.id ?? business.businessId;
      const limits = getPlanLimits(business.plan);
      res.json({
        ok: true,
        business: { ...business, id: businessId },
        planLimits: limits
      });
    } catch (err) {
      console.error("Error in POST /api/businesses/:id:", err);
      if (err.name === "ValidationError") {
        return res.status(400).json({ ok: false, error: err.message });
      }
      if (err.code === 11000) {
        return res.status(409).json({
          ok: false,
          error: "Duplicate value (e.g. phone number already in use)"
        });
      }
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/:id/plan", requireApiKey, async (req, res) => {
    try {
      const { id } = req.params;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { business, businessId } = resolved;
      const limits = getPlanLimits(business.plan);
      const servicesCount = await Service.countDocuments({ businessId });
      const usage = {
        services: servicesCount,
        teamMembers: 0
      };
      res.json({
        ok: true,
        plan: business.plan || "starter",
        limits,
        usage
      });
    } catch (err) {
      console.error("Error in GET /api/businesses/:id/plan:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.post("/:id/assign-number", requireApiKey, async (req, res) => {
    try {
      const { id } = req.params;
      const { assignedTwilioNumber } = req.body;

      if (!assignedTwilioNumber) {
        return res.status(400).json({
          ok: false,
          error: "Field 'assignedTwilioNumber' is required"
        });
      }

      const normalizedNumber = normalizePhoneNumber(assignedTwilioNumber);
      if (!normalizedNumber) {
        return res.status(400).json({
          ok: false,
          error: "Invalid phone number format"
        });
      }

      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({
          ok: false,
          error: "Business not found"
        });
      }

      if (!isFeatureAllowed(resolved.business.plan || "starter", "aiPhoneAgent")) {
        return res.status(403).json({
          ok: false,
          error:
            "Dedicated phone numbers are not included on this plan. Upgrade to Growth or Enterprise.",
          upgrade: true
        });
      }

      const business = await Business.findByIdAndUpdate(
        resolved.business._id,
        { $set: { assignedTwilioNumber: normalizedNumber } },
        { new: true }
      ).lean();

      if (!business) {
        return res.status(404).json({
          ok: false,
          error: "Business not found"
        });
      }

      const businessId = business.id ?? business.businessId;
      res.json({
        ok: true,
        businessId,
        assignedTwilioNumber: normalizedNumber,
        business: { ...business, id: businessId }
      });
    } catch (err) {
      console.error("Error in POST /api/businesses/:id/assign-number:", err);

      if (err.code === 11000) {
        return res.status(400).json({
          ok: false,
          error: "This Twilio number is already assigned to another business"
        });
      }

      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/", strictLimiter, requireInternalAuth, async (req, res) => {
    try {
      const { category } = req.query;
      const filter = {};
      if (category) filter.category = category;

      const businesses = await Business.find(filter).lean();
      res.json({ ok: true, businesses });
    } catch (err) {
      console.error("Error in GET /api/businesses:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.post("/", requireApiKey, async (req, res) => {
    try {
      const {
        id,
        name,
        description,
        category,
        timezone,
        phoneNumber,
        email,
        assignedTwilioNumber,
        greetingOverride,
        services,
        bookingSettings
      } = req.body;

      if (!id || !name) {
        return res.status(400).json({
          ok: false,
          error: "Fields 'id' and 'name' are required"
        });
      }

      let finalCategory = category;
      if (!finalCategory) {
        finalCategory = await classifyBusinessCategory({ name, description });
      }

      const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
      const normalizedAssignedTwilioNumber = normalizePhoneNumber(assignedTwilioNumber);

      const publicHandle = await generateUniquePublicSlug(name, { excludingId: id });

      const update = {
        id,
        businessId: id,
        name,
        handle: publicHandle,
        description,
        category: finalCategory,
        timezone,
        phoneNumber: normalizedPhoneNumber,
        email,
        assignedTwilioNumber: normalizedAssignedTwilioNumber,
        greetingOverride,
        services,
        bookingSettings
      };

      const business = await Business.findOneAndUpdate(
        { id },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();

      res.json({ ok: true, business });
    } catch (err) {
      console.error("Error in POST /api/businesses:", err);

      if (err.code === 11000) {
        const field = err.keyPattern ? Object.keys(err.keyPattern)[0] : "field";
        return res.status(400).json({
          ok: false,
          error: `Business with this ${field} already exists`
        });
      }

      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  return router;
}

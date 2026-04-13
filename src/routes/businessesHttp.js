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
import { isInternalCoreApiRequest, safeCompare } from "../middleware/internalAuth.js";
import { toPublicGooglePlaces } from "../utils/googlePlacesPublic.js";
import { toPublicPortfolio } from "../utils/businessPortfolioPublic.js";
import { placeDetails, isGooglePlacesConfigured } from "../../services/googlePlacesApi.js";
import { applyGooglePlacesToBusiness } from "../../services/googlePlacesSync.js";
import {
  findBusinessByParam,
  toPublicBusinessPayload,
  mapNumberSetupMethodForSchema,
  normalizePhoneNumber,
  generateUniquePublicSlug,
  ownerHeaderMatchesBusiness
} from "../utils/businessRouteHelpers.js";
import { classifyBusinessCategory } from "../../services/categoryClassifier.js";
import { ensureBookableDefaultsForBusiness } from "../../services/bookableBootstrap.js";
import {
  copyFranchiseServicesToNewBusiness,
  franchiseSyncAfterServiceCreate,
  franchiseSyncAfterServiceUpdate
} from "../../services/franchiseServiceSync.js";
import { publicBookingLimiter } from "../middleware/publicBookingLimiter.js";
import { trialDeniedDashboardWrite, buildTrialStatusPayload } from "../utils/trialLifecycle.js";

/** Dashboard / book8-ai list all services; public booking widget only sees active. */
function hasServiceListManagementAuth(req) {
  const apiKey = req.headers["x-book8-api-key"];
  const expectedKey = process.env.BOOK8_CORE_API_KEY;
  const internal =
    req.headers["x-book8-internal-secret"] || req.headers["x-internal-secret"];
  const expectedInternal =
    process.env.CORE_API_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET;
  const okApi = !!(expectedKey && apiKey && safeCompare(apiKey, expectedKey));
  const okInt = !!(expectedInternal && internal && safeCompare(internal, expectedInternal));
  return okApi || okInt;
}

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

  router.get("/:id/trial-status", strictLimiter, requireInternalSecretOrApiKey, async (req, res) => {
    try {
      const { id } = req.params;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const payload = buildTrialStatusPayload(resolved.business);
      return res.json({ ok: true, ...payload });
    } catch (err) {
      console.error("Error in GET /api/businesses/:id/trial-status:", err);
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/:id/services", publicBookingLimiter, async (req, res) => {
    try {
      const { id } = req.params;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { businessId } = resolved;
      const filter = hasServiceListManagementAuth(req)
        ? { businessId }
        : { businessId, active: true };
      const services = await Service.find(filter).lean();
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
      const td = trialDeniedDashboardWrite(business);
      if (td) return res.status(td.status).json(td.body);
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
      await franchiseSyncAfterServiceCreate(businessId, doc.toObject());
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
      const { business, businessId } = resolved;
      const td0 = trialDeniedDashboardWrite(business);
      if (td0) return res.status(td0.status).json(td0.body);
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
      await franchiseSyncAfterServiceUpdate(businessId, serviceId, update);
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
      const { business, businessId } = resolved;
      const tdP = trialDeniedDashboardWrite(business);
      if (tdP) return res.status(tdP.status).json(tdP.body);
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
      await franchiseSyncAfterServiceUpdate(businessId, serviceId, update);
      res.json({ ok: true, businessId, service });
    } catch (err) {
      console.error("Error in PATCH /api/businesses/:id/services/:serviceId:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/:id/schedule", publicBookingLimiter, async (req, res) => {
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
      const { business, businessId } = resolved;
      const tdS = trialDeniedDashboardWrite(business);
      if (tdS) return res.status(tdS.status).json(tdS.body);
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

  router.get("/:id/public", publicBookingLimiter, async (req, res) => {
    try {
      const { id } = req.params;
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { business, businessId } = resolved;
      const pl = business.plan ? String(business.plan).toLowerCase() : "";
      if (!pl || pl === "none") {
        const bid = encodeURIComponent(String(businessId));
        return res.status(402).json({
          ok: false,
          error: "This business requires an active subscription",
          message: "Please select a plan for this location",
          upgradeUrl: `https://www.book8.io/setup?step=2&businessId=${bid}`,
          subscriptionRequired: true
        });
      }
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

  /** Public booking address lives in businessProfile.address. Internal secret OR API key + owner email. */
  router.patch("/:id/profile", strictLimiter, requireInternalSecretOrApiKey, async (req, res) => {
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

      if (!isInternalCoreApiRequest(req)) {
        const ownerHeader = req.headers["x-book8-user-email"];
        if (!ownerHeader || !String(ownerHeader).trim()) {
          return res.status(403).json({
            ok: false,
            error: "x-book8-user-email header is required when using API key"
          });
        }
        if (!ownerHeaderMatchesBusiness(doc.toObject(), ownerHeader)) {
          return res.status(403).json({
            ok: false,
            error: "Forbidden: x-book8-user-email does not match this business owner"
          });
        }
        const tdProfile = trialDeniedDashboardWrite(doc.toObject());
        if (tdProfile) return res.status(tdProfile.status).json(tdProfile.body);
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

  /** BOO-102A — opt out of monthly insights recap email */
  router.patch("/:id/notification-preferences", strictLimiter, requireInternalSecretOrApiKey, async (req, res) => {
    try {
      const { id } = req.params;
      const { monthlyRecapEmail } = req.body || {};
      if (typeof monthlyRecapEmail !== "boolean") {
        return res.status(400).json({
          ok: false,
          error: "monthlyRecapEmail (boolean) is required"
        });
      }
      const doc = await Business.findOne({ $or: [{ id }, { businessId: id }] });
      if (!doc) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      if (!isInternalCoreApiRequest(req)) {
        const ownerHeader = req.headers["x-book8-user-email"];
        if (!ownerHeader || !String(ownerHeader).trim()) {
          return res.status(403).json({
            ok: false,
            error: "x-book8-user-email header is required when using API key"
          });
        }
        if (!ownerHeaderMatchesBusiness(doc.toObject(), ownerHeader)) {
          return res.status(403).json({
            ok: false,
            error: "Forbidden: x-book8-user-email does not match this business owner"
          });
        }
        const tdNp = trialDeniedDashboardWrite(doc.toObject());
        if (tdNp) return res.status(tdNp.status).json(tdNp.body);
      }

      doc.notifications = doc.notifications || {};
      doc.notifications.preferences = doc.notifications.preferences || {};
      doc.notifications.preferences.monthlyRecapEmail = monthlyRecapEmail;
      await doc.save();
      return res.json({ ok: true, business: doc.toObject() });
    } catch (err) {
      console.error("Error in PATCH /api/businesses/:id/notification-preferences:", err);
      return res.status(500).json({ ok: false, error: "Internal server error" });
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
      const tdSync = trialDeniedDashboardWrite(doc.toObject());
      if (tdSync) return res.status(tdSync.status).json(tdSync.body);
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

  router.get("/:id/reviews", publicBookingLimiter, handleGetBusinessReviews);

  router.get("/:id", publicBookingLimiter, async (req, res) => {
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

      const tdPost = trialDeniedDashboardWrite(resolved.business);
      if (tdPost) return res.status(tdPost.status).json(tdPost.body);

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

      const tdAssign = trialDeniedDashboardWrite(resolved.business);
      if (tdAssign) return res.status(tdAssign.status).json(tdAssign.body);

      const rawPlan = resolved.business.plan;
      if (!rawPlan || String(rawPlan).toLowerCase() === "none") {
        const bid = encodeURIComponent(String(resolved.business.id ?? resolved.business.businessId ?? ""));
        return res.status(402).json({
          ok: false,
          error: "This business requires an active subscription",
          message: "Please select a plan for this location",
          upgradeUrl: `https://www.book8.io/setup?step=2&businessId=${bid}`,
          subscriptionRequired: true
        });
      }

      if (!isFeatureAllowed(rawPlan, "aiPhoneAgent")) {
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

      const existedBefore = await Business.findOne({ id }).lean();

      const business = await Business.findOneAndUpdate(
        { id },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();

      if (!existedBefore) {
        const copied = await copyFranchiseServicesToNewBusiness(id);
        await ensureBookableDefaultsForBusiness(id, {
          timezone: timezone || "America/Toronto",
          skipServices: copied
        });
      }

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

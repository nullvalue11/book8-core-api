// index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";

import { Business } from "./models/Business.js";
import { Service } from "./models/Service.js";
import { Schedule } from "./models/Schedule.js";
import { Booking } from "./models/Booking.js";
import { TwilioNumber } from "./models/TwilioNumber.js";
import twilio from "twilio";
import { classifyBusinessCategory } from "./services/categoryClassifier.js";
import { getDefaultServices, getDefaultWeeklySchedule } from "./services/bootstrapDefaults.js";
import { ensureBookableDefaultsForBusiness } from "./services/bookableBootstrap.js";
import { listCategories } from "./services/categoryDefaults.js";
import { sendSMS, formatReminderSMS } from "./services/smsService.js";
import { sendReminder as sendReminderEmail } from "./services/emailService.js";
import {
  requireInternalAuth,
  isInternalCoreApiRequest,
  safeCompare
} from "./src/middleware/internalAuth.js";
import { strictLimiter } from "./src/middleware/strictLimiter.js";
import {
  buildPublicBusinessProfile,
  mergeBusinessProfile,
  validateBusinessProfileMerged
} from "./src/utils/businessProfile.js";
import { getPlanLimits, isFeatureAllowed } from "./services/planLimits.js";
import internalCallsRouter from "./src/routes/internalCalls.js";
import internalUsageRouter from "./src/routes/internalUsage.js";
import internalBookingsRouter from "./src/routes/internalBookings.js";
import internalBusinessRouter from "./src/routes/internalBusiness.js";
import calendarRouter from "./src/routes/calendar.js";
import bookingsRouter from "./src/routes/bookings.js";
import internalExecuteToolRouter from "./src/routes/internalExecuteTool.js";
import internalProvisionRouter from "./src/routes/internalProvision.js";
import healthCheckRouter from "./src/routes/healthCheck.js";
import elevenLabsWebhookRouter from "./src/routes/elevenLabsWebhook.js";
import twilioInboundRouter from "./src/routes/twilioInbound.js";
import twilioPoolRouter from "./src/routes/twilioPool.js";
import businessLogoRouter from "./src/routes/businessLogo.js";
import businessPortfolioRouter from "./src/routes/businessPortfolio.js";
import providersRouter from "./src/routes/providers.js";
import noShowBusinessRouter from "./src/routes/noShowBusiness.js";
import bookingNoShowExtras from "./src/routes/bookingNoShowExtras.js";
import placesRouter from "./src/routes/places.js";
import { toPublicGooglePlaces } from "./src/utils/googlePlacesPublic.js";
import { toPublicPortfolio } from "./src/utils/businessPortfolioPublic.js";
import { placeDetails, isGooglePlacesConfigured } from "./services/googlePlacesApi.js";
import { applyGooglePlacesToBusiness } from "./services/googlePlacesSync.js";
import { configureTwilioVoiceForPoolNumber } from "./services/twilioNumberSetup.js";

const app = express();

const PORT = process.env.PORT || 5050;
const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/book8-core";

if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
  console.warn("[book8-core-api] MONGODB_URI not set — using local fallback");
}

// In test, connect immediately so test setup can use the DB; in production, connect after listen (see START SERVER).
if (process.env.NODE_ENV === "test") {
  mongoose
    .connect(MONGODB_URI)
    .then(() => console.log("[book8-core-api] Connected to MongoDB"))
    .catch((err) => {
      console.error("[book8-core-api] MongoDB connection error:", err);
      process.exit(1);
    });
}

// ---------- MIDDLEWARE ----------
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
      : ["https://www.book8.io", "https://book8.io"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Book8-Internal-Secret",
      "X-Internal-Secret",
      "X-Book8-Api-Key",
      "X-Book8-Webhook-Secret"
    ],
    credentials: true
  })
);
app.use(
  express.json({
    limit: "512kb",
    verify: (req, res, buf) => {
      if (req.originalUrl.includes("/api/elevenlabs/")) {
        req.rawBody = buf;
      }
    }
  })
);
app.use(express.urlencoded({ extended: true, limit: "512kb" }));

// ---------- API KEY MIDDLEWARE (for write routes) ----------
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers["x-book8-api-key"];
  const expectedKey = process.env.BOOK8_CORE_API_KEY;

  if (!expectedKey) {
    console.error("BOOK8_CORE_API_KEY environment variable is not set");
    return res.status(500).json({
      ok: false,
      error: "Server configuration error"
    });
  }

  if (!safeCompare(apiKey || "", expectedKey)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: Invalid or missing API key"
    });
  }

  next();
};

/**
 * Dashboard (book8-ai) phone setup uses x-book8-internal-secret; some callers use x-book8-api-key.
 */
const requireInternalSecretOrApiKey = (req, res, next) => {
  const internal =
    req.headers["x-book8-internal-secret"] || req.headers["x-internal-secret"];
  const expectedInternal =
    process.env.CORE_API_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET;
  const apiKey = req.headers["x-book8-api-key"];
  const expectedKey = process.env.BOOK8_CORE_API_KEY;

  const okInternal = !!(expectedInternal && internal && safeCompare(internal, expectedInternal));
  const okApi = !!(expectedKey && apiKey && safeCompare(apiKey, expectedKey));

  if (okInternal || okApi) {
    return next();
  }

  if (!expectedInternal && !expectedKey) {
    return res.status(500).json({
      ok: false,
      error: "Server configuration error: no auth secret configured"
    });
  }

  return res.status(401).json({
    ok: false,
    error: "Unauthorized: Invalid or missing internal secret or API key"
  });
};

/** Public booking / widget: no Stripe, plan, Book8 Twilio number, or internal-only fields. */
function toPublicBusinessPayload(business) {
  const id = business.id ?? business.businessId;
  return {
    _id: business._id,
    id,
    businessId: business.businessId ?? id,
    name: business.name,
    handle: business.handle,
    category: business.category,
    timezone: business.timezone,
    primaryLanguage: business.primaryLanguage,
    multilingualEnabled: business.multilingualEnabled,
    businessProfile: buildPublicBusinessProfile(business)
  };
}

/** book8-ai sends forward|dedicated; schema uses forwarding|direct */
function mapNumberSetupMethodForSchema(raw) {
  if (raw == null || raw === "") return undefined;
  const s = String(raw).toLowerCase();
  if (s === "forward" || s === "forwarding") return "forwarding";
  if (s === "dedicated" || s === "direct") return "direct";
  if (s === "pending") return "pending";
  return undefined;
}

// ---------- HELPER: Generate slug from business name ----------
function generateSlug(name) {
  if (!name) return null;
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

// ---------- HELPER: Normalize phone number to E.164 format ----------
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  const str = String(phone).trim();
  if (!str) return null;
  // Remove all non-digit characters except leading +
  const normalized = str.replace(/[^\d+]/g, "");
  // Ensure it starts with + for E.164 format
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

// ---------- ROOT (for load balancer / health probes) ----------
app.get("/", (req, res) => {
  res.json({ ok: true, service: "book8-core-api" });
});

// ---------- HEALTH CHECK ----------
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "book8-core-api" });
});

// ---------- RESOLVE BUSINESS BY PHONE NUMBER ----------
app.get("/api/resolve", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { to } = req.query;

    if (!to) {
      return res.status(400).json({
        ok: false,
        error: "Missing 'to' phone number"
      });
    }

    // Normalize phone number to E.164 format for consistent lookup
    const normalizedTo = normalizePhoneNumber(to);
    if (!normalizedTo) {
      return res.status(400).json({
        ok: false,
        error: "Invalid phone number format"
      });
    }

    // Query by assignedTwilioNumber (exact match)
    const business = await Business.findOne({
      assignedTwilioNumber: normalizedTo
    }).lean();

    if (!business) {
      return res.status(404).json({
        ok: false,
        error: "No business found for this phone number"
      });
    }

    // Return only businessId
    res.json({ ok: true, businessId: business.id });
  } catch (err) {
    console.error("Error in GET /api/resolve:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- ONBOARD BUSINESS ----------
app.post("/api/onboard", requireApiKey, async (req, res) => {
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

    // Generate slug from name
    let businessId = generateSlug(name);
    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: "Unable to generate business ID from name"
      });
    }

    // Ensure unique ID - if exists, append number
    let counter = 1;
    let finalId = businessId;
    while (await Business.findOne({ id: finalId })) {
      finalId = `${businessId}-${counter}`;
      counter++;
    }

    // Classify category if missing
    let finalCategory = category;
    if (!finalCategory) {
      finalCategory = await classifyBusinessCategory({ name, description });
    }

    // Normalize phone number to E.164 format
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    const tz = timezone || "America/Toronto";
    const servicesToUse = Array.isArray(services) && services.length > 0 ? services : getDefaultServices();
    const weeklyScheduleToUse = getDefaultWeeklySchedule(tz);

    // Create business
    const business = new Business({
      id: finalId,
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
    
    // Handle duplicate key errors (e.g., duplicate phone number)
    if (err.code === 11000) {
      return res.status(400).json({
        ok: false,
        error: "Business with this phone number already exists"
      });
    }

    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- PROVISION BUSINESS (SaaS-style onboarding) ----------
app.post("/api/provision", requireApiKey, async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      timezone,
      email,
      phoneNumber,
      services
    } = req.body;

    if (!name) {
      return res.status(400).json({
        ok: false,
        error: "Field 'name' is required"
      });
    }

    // Generate slug from name
    let businessId = generateSlug(name);
    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: "Unable to generate business ID from name"
      });
    }

    // Ensure unique ID - if exists, append number
    let counter = 1;
    let finalId = businessId;
    while (await Business.findOne({ id: finalId })) {
      finalId = `${businessId}-${counter}`;
      counter++;
    }

    // Classify category if missing
    let finalCategory = category;
    if (!finalCategory) {
      finalCategory = await classifyBusinessCategory({ name, description });
    }

    // Normalize phone number to E.164 format if provided
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    const tz = timezone || "America/Toronto";
    const servicesToUse = Array.isArray(services) && services.length > 0 ? services : getDefaultServices();
    const weeklyScheduleToUse = getDefaultWeeklySchedule(tz);

    // Create business
    const business = new Business({
      id: finalId,
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

    // Return clean payload with next steps
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
    
    // Handle duplicate key errors
    if (err.code === 11000) {
      return res.status(400).json({
        ok: false,
        error: "Business with this phone number already exists"
      });
    }

    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// Resolve business by URL param: support both `id` and `businessId` (e.g. biz_xxx from Ops/n8n).
async function findBusinessByParam(param) {
  if (!param) return null;
  const business = await Business.findOne({
    $or: [{ id: param }, { businessId: param }]
  }).lean();
  if (!business) return null;
  const businessId = business.id ?? business.businessId;
  return { business: { ...business, id: businessId }, businessId };
}

app.use("/api/businesses", businessLogoRouter);
app.use("/api/businesses", businessPortfolioRouter);
app.use("/api/businesses", providersRouter);
app.use("/api/businesses", noShowBusinessRouter);

// ---------- GET BUSINESS SERVICES ----------
app.get("/api/businesses/:id/services", async (req, res) => {
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

// ---------- POST BUSINESS SERVICE ----------
app.post("/api/businesses/:id/services", requireApiKey, async (req, res) => {
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

// ---------- PUT BUSINESS SERVICE (update name, duration, active) ----------
app.put("/api/businesses/:id/services/:serviceId", requireApiKey, async (req, res) => {
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

// ---------- PATCH BUSINESS SERVICE (dashboard — internal secret) ----------
app.patch("/api/businesses/:id/services/:serviceId", requireInternalAuth, async (req, res) => {
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

// ---------- GET BUSINESS SCHEDULE ----------
app.get("/api/businesses/:id/schedule", async (req, res) => {
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
          monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: []
        }
      };
    }
    res.json({ ok: true, businessId, schedule });
  } catch (err) {
    console.error("Error in GET /api/businesses/:id/schedule:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- PUT BUSINESS SCHEDULE ----------
app.put("/api/businesses/:id/schedule", requireApiKey, async (req, res) => {
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

// ---------- GET PUBLIC BOOKING PAGE PAYLOAD (no auth) ----------
app.get("/api/businesses/:id/public", strictLimiter, async (req, res) => {
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

// ---------- PATCH BUSINESS PROFILE (internal) ----------
app.patch("/api/businesses/:id/profile", strictLimiter, requireInternalAuth, async (req, res) => {
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

// ---------- SYNC GOOGLE PLACES (BOO-54A) ----------
app.post("/api/businesses/:id/sync-google-places", strictLimiter, requireInternalAuth, async (req, res) => {
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

// ---------- GET BUSINESS BY ID ----------
app.get("/api/businesses/:id", strictLimiter, async (req, res) => {
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

// ---------- UPDATE BUSINESS (dashboard phone setup — book8-ai POST) ----------
app.post("/api/businesses/:id", requireInternalSecretOrApiKey, async (req, res) => {
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
      update.name = name.trim();
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
        phoneNumber === null || phoneNumber === ""
          ? null
          : normalizePhoneNumber(phoneNumber);
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

// ---------- GET BUSINESS PLAN ----------
app.get("/api/businesses/:id/plan", requireApiKey, async (req, res) => {
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

// ---------- ASSIGN TWILIO NUMBER TO BUSINESS ----------
app.post("/api/businesses/:id/assign-number", requireApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTwilioNumber } = req.body;

    if (!assignedTwilioNumber) {
      return res.status(400).json({
        ok: false,
        error: "Field 'assignedTwilioNumber' is required"
      });
    }

    // Normalize phone number to E.164 format
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

    // Update by _id so we match the document whether it used id or businessId
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
    
    // Handle duplicate key errors (e.g., number already assigned to another business)
    if (err.code === 11000) {
      return res.status(400).json({
        ok: false,
        error: "This Twilio number is already assigned to another business"
      });
    }

    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- LIST CATEGORIES (for signup / dropdown) ----------
app.get("/api/categories", (req, res) => {
  const categories = listCategories();
  res.json({ ok: true, categories });
});

// ---------- LIST BUSINESSES (optional helper) ----------
app.get("/api/businesses", strictLimiter, requireInternalAuth, async (req, res) => {
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

// ---------- CREATE/UPDATE BUSINESS ----------
app.post("/api/businesses", requireApiKey, async (req, res) => {
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

    // Normalize phone numbers to E.164 format
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const normalizedAssignedTwilioNumber = normalizePhoneNumber(assignedTwilioNumber);

    const update = {
      id,
      name,
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
    
    // Handle duplicate key errors (e.g., duplicate phone number or assignedTwilioNumber)
    if (err.code === 11000) {
      const field = err.keyPattern ? Object.keys(err.keyPattern)[0] : 'field';
      return res.status(400).json({
        ok: false,
        error: `Business with this ${field} already exists`
      });
    }

    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- CALENDAR & BOOKINGS ----------
app.use("/api/calendar", calendarRouter);
app.use("/api/places", placesRouter);
app.use("/api/bookings", bookingNoShowExtras);
app.use("/api/bookings", bookingsRouter);
app.use("/api/twilio", twilioInboundRouter);
// ElevenLabs Conversation Initiation Webhook (public — authenticated via ElevenLabs secrets)
app.use("/api/elevenlabs", elevenLabsWebhookRouter);

// ---------- CRON: Send appointment reminders ----------
app.get("/api/cron/send-reminders", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token =
      authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || !token || !safeCompare(token, expectedSecret)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const bookingsToRemind = await Booking.find({
      status: "confirmed",
      reminderSentAt: { $exists: false },
      "slot.start": { $gte: in24Hours.toISOString(), $lte: in25Hours.toISOString() }
    }).lean();

    console.log(`[send-reminders] Found ${bookingsToRemind.length} bookings to remind`);

    let sent = 0;
    let failed = 0;

    for (const booking of bookingsToRemind) {
      try {
        const customerPhone = booking.customer?.phone;
        if (!customerPhone) {
          console.log(`[send-reminders] No phone for booking ${booking.id} — skipping`);
          continue;
        }

        const business = await Business.findOne({ id: booking.businessId }).lean();
        const fromNumber = business?.assignedTwilioNumber;
        if (!fromNumber) {
          console.log(`[send-reminders] No Twilio number for business ${booking.businessId} — skipping`);
          continue;
        }

        const plan = business?.plan || "starter";
        const smsAllowed = isFeatureAllowed(plan, "smsConfirmations");

        const tz = business?.timezone || booking.slot?.timezone || "America/Toronto";
        const slotDate = new Date(booking.slot.start);
        const dateStr = slotDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: tz
        });
        const timeStr = slotDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: tz
        });

        let serviceName = booking.serviceId || "Appointment";
        try {
          const svc = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          if (svc) serviceName = svc.name;
        } catch {
          // use fallback
        }

        const smsBody = formatReminderSMS({
          serviceName,
          businessName: business.name || booking.businessId,
          date: dateStr,
          time: timeStr,
          isOneHour: false
        });

        if (smsAllowed) {
          const smsResult = await sendSMS({
            to: customerPhone,
            from: fromNumber,
            body: smsBody
          });

          if (smsResult.ok) {
            await Booking.findOneAndUpdate(
              { id: booking.id },
              { $set: { reminderSentAt: new Date(), reminderSid: smsResult.messageSid } }
            );
            sent++;
          } else {
            failed++;
          }
        } else {
          console.log(
            `[send-reminders] SMS skipped — plan "${plan}" has no smsConfirmations (${booking.businessId})`
          );
          await Booking.findOneAndUpdate(
            { id: booking.id },
            { $set: { reminderSentAt: new Date() } }
          );
        }

        if (booking.customer?.email && !booking.reminderEmailSentAt) {
          const svcForEmail = await Service.findOne({ businessId: booking.businessId, serviceId: booking.serviceId }).lean();
          sendReminderEmail(booking, business, svcForEmail || { name: serviceName }, booking.customer, "24h")
            .then(async (result) => {
              if (result?.id) {
                await Booking.findOneAndUpdate(
                  { id: booking.id },
                  { $set: { reminderEmailSentAt: new Date(), reminderEmailId: result.id } }
                );
              }
            })
            .catch((err) => console.error("[send-reminders] Reminder email failed:", err.message));
        }
      } catch (err) {
        console.error(`[send-reminders] Error processing booking ${booking.id}:`, err);
        failed++;
      }
    }

    const in1Hour = new Date(now.getTime() + 60 * 60 * 1000);
    const in90Min = new Date(now.getTime() + 90 * 60 * 1000);

    const shortReminders = await Booking.find({
      status: "confirmed",
      shortReminderSentAt: { $exists: false },
      "slot.start": { $gte: in1Hour.toISOString(), $lte: in90Min.toISOString() }
    }).lean();

    console.log(`[send-reminders] Found ${shortReminders.length} bookings for 1-hour reminder`);

    for (const booking of shortReminders) {
      try {
        const customerPhone = booking.customer?.phone;
        if (!customerPhone) continue;

        const business = await Business.findOne({ id: booking.businessId }).lean();
        const fromNumber = business?.assignedTwilioNumber;
        if (!fromNumber) continue;

        const plan = business?.plan || "starter";
        const smsAllowed = isFeatureAllowed(plan, "smsConfirmations");

        let serviceName = booking.serviceId || "Appointment";
        try {
          const svc = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          if (svc) serviceName = svc.name;
        } catch {
          // use fallback
        }

        const smsBody = formatReminderSMS({
          serviceName,
          businessName: business.name || booking.businessId,
          date: "",
          time: "",
          isOneHour: true
        });

        if (smsAllowed) {
          const smsResult = await sendSMS({
            to: customerPhone,
            from: fromNumber,
            body: smsBody
          });

          if (smsResult.ok) {
            await Booking.findOneAndUpdate(
              { id: booking.id },
              { $set: { shortReminderSentAt: new Date(), shortReminderSid: smsResult.messageSid } }
            );
            sent++;
          } else {
            failed++;
          }
        } else {
          console.log(
            `[send-reminders] 1h SMS skipped — plan "${plan}" has no smsConfirmations (${booking.businessId})`
          );
          await Booking.findOneAndUpdate(
            { id: booking.id },
            { $set: { shortReminderSentAt: new Date() } }
          );
        }

        if (booking.customer?.email && !booking.shortReminderEmailSentAt) {
          const svcForEmail = await Service.findOne({ businessId: booking.businessId, serviceId: booking.serviceId }).lean();
          sendReminderEmail(booking, business, svcForEmail || { name: serviceName }, booking.customer, "1h")
            .then(async (result) => {
              if (result?.id) {
                await Booking.findOneAndUpdate(
                  { id: booking.id },
                  { $set: { shortReminderEmailSentAt: new Date(), shortReminderEmailId: result.id } }
                );
              }
            })
            .catch((err) => console.error("[send-reminders] 1h reminder email failed:", err.message));
        }
      } catch (err) {
        console.error(`[send-reminders] Error on 1-hour reminder for ${booking.id}:`, err);
        failed++;
      }
    }

    const in30Min = new Date(now.getTime() + 30 * 60 * 1000);
    const in45Min = new Date(now.getTime() + 45 * 60 * 1000);

    const lastMinuteReminders = await Booking.find({
      status: "confirmed",
      lastMinuteReminderSentAt: { $exists: false },
      "slot.start": { $gte: in30Min.toISOString(), $lte: in45Min.toISOString() }
    }).lean();

    console.log(`[send-reminders] Found ${lastMinuteReminders.length} bookings for 30-minute reminder`);

    for (const booking of lastMinuteReminders) {
      try {
        const customerPhone = booking.customer?.phone;
        if (!customerPhone) continue;

        const business = await Business.findOne({ id: booking.businessId }).lean();
        const fromNumber = business?.assignedTwilioNumber;
        if (!fromNumber) continue;

        const plan = business?.plan || "starter";
        const smsAllowed = isFeatureAllowed(plan, "smsConfirmations");

        let serviceName = booking.serviceId || "Appointment";
        try {
          const svc = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          if (svc) serviceName = svc.name;
        } catch {
          // use fallback
        }

        const smsBody = formatReminderSMS({
          serviceName,
          businessName: business.name || booking.businessId,
          date: "",
          time: "",
          isOneHour: false,
          isThirtyMinutes: true
        });

        if (smsAllowed) {
          const smsResult = await sendSMS({
            to: customerPhone,
            from: fromNumber,
            body: smsBody
          });

          if (smsResult.ok) {
            await Booking.findOneAndUpdate(
              { id: booking.id },
              {
                $set: {
                  lastMinuteReminderSentAt: new Date(),
                  lastMinuteReminderSid: smsResult.messageSid
                }
              }
            );
            sent++;
          } else {
            failed++;
          }
        } else {
          console.log(
            `[send-reminders] 30min SMS skipped — plan "${plan}" has no smsConfirmations (${booking.businessId})`
          );
          await Booking.findOneAndUpdate(
            { id: booking.id },
            { $set: { lastMinuteReminderSentAt: new Date() } }
          );
        }

        if (booking.customer?.email && !booking.lastMinuteReminderEmailSentAt) {
          const svcForEmail = await Service.findOne({ businessId: booking.businessId, serviceId: booking.serviceId }).lean();
          sendReminderEmail(booking, business, svcForEmail || { name: serviceName }, booking.customer, "30min")
            .then(async (result) => {
              if (result?.id) {
                await Booking.findOneAndUpdate(
                  { id: booking.id },
                  { $set: { lastMinuteReminderEmailSentAt: new Date(), lastMinuteReminderEmailId: result.id } }
                );
              }
            })
            .catch((err) => console.error("[send-reminders] 30min reminder email failed:", err.message));
        }
      } catch (err) {
        console.error(`[send-reminders] Error on 30-minute reminder for ${booking.id}:`, err);
        failed++;
      }
    }

    console.log(`[send-reminders] Done: ${sent} sent, ${failed} failed`);
    return res.json({
      ok: true,
      processed:
        bookingsToRemind.length + shortReminders.length + lastMinuteReminders.length,
      sent,
      failed
    });
  } catch (err) {
    console.error("[send-reminders] Error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- CRON: Replenish Twilio number pool ----------
app.get("/api/cron/replenish-pool", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token =
      authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || !token || !safeCompare(token, expectedSecret)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const availableCount = await TwilioNumber.countDocuments({ status: "available" });
    if (availableCount >= 3) {
      return res.json({ ok: true, available: availableCount, purchased: 0 });
    }

    const needed = 5 - availableCount;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      return res.status(503).json({ ok: false, error: "Twilio not configured" });
    }

    const twilioClient = twilio(accountSid, authToken);
    const available = await twilioClient.availablePhoneNumbers("CA").local.list({
      smsEnabled: true,
      voiceEnabled: true,
      limit: needed
    });

    let purchasedCount = 0;
    for (const num of available) {
      try {
        const purchased = await twilioClient.incomingPhoneNumbers.create({
          phoneNumber: num.phoneNumber
        });
        await TwilioNumber.create({
          phoneNumber: purchased.phoneNumber,
          twilioSid: purchased.sid,
          areaCode: purchased.phoneNumber.slice(2, 5),
          status: "available",
          capabilities: { voice: true, sms: true }
        });
        purchasedCount++;
        const voiceOk = await configureTwilioVoiceForPoolNumber(purchased.sid);
        if (!voiceOk) {
          console.warn(
            "[replenish] Purchased",
            purchased.phoneNumber,
            "— voice webhook not set; configure manually or re-run assignment flow"
          );
        }
      } catch (err) {
        console.error("[replenish] Failed to purchase", num.phoneNumber, err.message);
      }
    }

    const newAvailable = await TwilioNumber.countDocuments({ status: "available" });
    return res.json({ ok: true, available: newAvailable, purchased: purchasedCount });
  } catch (err) {
    console.error("[replenish-pool] Error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- MOUNT INTERNAL ROUTES ----------
app.use("/internal/calls", requireInternalAuth, internalCallsRouter);
app.use("/internal/usage", requireInternalAuth, internalUsageRouter);
app.use("/internal/bookings", requireInternalAuth, internalBookingsRouter);
app.use("/internal/business", requireInternalAuth, internalBusinessRouter);
app.use("/internal/execute-tool", requireInternalAuth, internalExecuteToolRouter);
app.use("/internal/provision-from-stripe", requireInternalAuth, internalProvisionRouter);
app.use("/api/health", requireInternalAuth, healthCheckRouter);
app.use("/internal/twilio-pool", requireInternalAuth, twilioPoolRouter);

// ---------- START SERVER ----------
// Bind port first so Render's port scan succeeds; then connect to MongoDB.
if (process.env.NODE_ENV !== "test") {
  const requireInitToken =
    process.env.NODE_ENV === "production" || process.env.RENDER === "true";
  if (requireInitToken && !process.env.ELEVENLABS_INIT_TOKEN) {
    console.error(
      "[book8-core-api] ELEVENLABS_INIT_TOKEN is required (ElevenLabs conversation-init webhook URL path)"
    );
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[book8-core-api] Listening on port ${PORT}`);
    mongoose
      .connect(MONGODB_URI)
      .then(() => console.log("[book8-core-api] Connected to MongoDB"))
      .catch((err) => {
        console.error("[book8-core-api] MongoDB connection error:", err);
        process.exit(1);
      });
  });
}

export { app };

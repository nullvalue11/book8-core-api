// index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
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
import { requireInternalAuth } from "./src/middleware/internalAuth.js";
import { getPlanLimits } from "./services/planLimits.js";
import internalCallsRouter from "./src/routes/internalCalls.js";
import internalUsageRouter from "./src/routes/internalUsage.js";
import calendarRouter from "./src/routes/calendar.js";
import bookingsRouter from "./src/routes/bookings.js";
import internalExecuteToolRouter from "./src/routes/internalExecuteTool.js";
import internalProvisionRouter from "./src/routes/internalProvision.js";
import elevenLabsWebhookRouter from "./src/routes/elevenLabsWebhook.js";
import twilioInboundRouter from "./src/routes/twilioInbound.js";
import twilioPoolRouter from "./src/routes/twilioPool.js";

const app = express();

const PORT = process.env.PORT || 5050;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/book8_core";

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
app.use(cors());
app.use(express.json());

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

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: Invalid or missing API key"
    });
  }

  next();
};

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
app.get("/api/resolve", async (req, res) => {
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
    const { serviceId, name, durationMinutes, active } = req.body;
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
    const doc = await Service.create({
      businessId,
      serviceId,
      name,
      durationMinutes: Number(durationMinutes),
      active: active !== false
    });
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
    const { name, durationMinutes, active } = req.body;
    const resolved = await findBusinessByParam(id);
    if (!resolved) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }
    const { businessId } = resolved;
    const update = {};
    if (name !== undefined) update.name = name;
    if (durationMinutes !== undefined) update.durationMinutes = Number(durationMinutes);
    if (active !== undefined) update.active = !!active;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ ok: false, error: "At least one of name, durationMinutes, or active is required" });
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

// ---------- GET BUSINESS BY ID ----------
app.get("/api/businesses/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const resolved = await findBusinessByParam(id);

    if (!resolved) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const { business } = resolved;
    const limits = getPlanLimits(business.plan);
    res.json({ ok: true, business: { ...business }, planLimits: limits });
  } catch (err) {
    console.error("Error in GET /api/businesses/:id:", err);
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
app.get("/api/businesses", async (req, res) => {
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
app.use("/api/bookings", bookingsRouter);
app.use("/api/twilio", twilioInboundRouter);
// ElevenLabs Conversation Initiation Webhook (public — authenticated via ElevenLabs secrets)
app.use("/api/elevenlabs", elevenLabsWebhookRouter);

// ---------- CRON: Send appointment reminders ----------
app.get("/api/cron/send-reminders", async (req, res) => {
  try {
    const secret = req.query.secret;
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
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

        const smsResult = await sendSMS({
          to: customerPhone,
          from: fromNumber,
          body: smsBody
        });

        if (smsResult.ok) {
          await Booking.findOneAndUpdate(
            { id: booking.id },
            { $set: { lastMinuteReminderSentAt: new Date(), lastMinuteReminderSid: smsResult.messageSid } }
          );
          sent++;
        } else {
          failed++;
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
      processed: bookingsToRemind.length + shortReminders.length,
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
    const secret = req.query.secret;
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
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
        console.warn("[replenish] Purchased", purchased.phoneNumber, "— register in ElevenLabs dashboard!");
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
app.use("/internal/execute-tool", requireInternalAuth, internalExecuteToolRouter);
app.use("/internal/provision-from-stripe", requireInternalAuth, internalProvisionRouter);
app.use("/internal/twilio-pool", requireInternalAuth, twilioPoolRouter);

// ---------- START SERVER ----------
// Bind port first so Render's port scan succeeds; then connect to MongoDB.
if (process.env.NODE_ENV !== "test") {
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

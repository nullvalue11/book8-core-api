// index.js — app bootstrap + route mounting (BOO-63A)
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";

import { safeCompare } from "./src/middleware/internalAuth.js";
import { strictLimiter } from "./src/middleware/strictLimiter.js";
import internalCallsRouter from "./src/routes/internalCalls.js";
import internalUsageRouter from "./src/routes/internalUsage.js";
import internalBookingsRouter from "./src/routes/internalBookings.js";
import internalBusinessRouter from "./src/routes/internalBusiness.js";
import calendarRouter from "./src/routes/calendar.js";
import bookingsRouter from "./src/routes/bookings.js";
import internalExecuteToolRouter from "./src/routes/internalExecuteTool.js";
import internalProvisionRouter from "./src/routes/internalProvision.js";
import internalSubscriptionSyncRouter from "./src/routes/internalSubscriptionSync.js";
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
import reviewsRouter, { handleGetBusinessReviews } from "./src/routes/reviews.js";
import waitlistRouter from "./src/routes/waitlist.js";
import rootHealthRouter from "./src/routes/rootHealth.js";
import createApiOnboardingRouter from "./src/routes/apiOnboarding.js";
import categoriesRouter from "./src/routes/categories.js";
import createBusinessesHttpRouter from "./src/routes/businessesHttp.js";
import createAggregateRouter from "./src/routes/aggregate.js";
import createBusinessServicesSyncRouter from "./src/routes/businessServicesSync.js";
import cronRouter from "./src/routes/cron.js";
import hardDeleteSoftDeletedRouter from "./src/routes/cron/hardDeleteSoftDeleted.js";
import { requireInternalAuth } from "./src/middleware/internalAuth.js";

const app = express();

// BOO-64A: Render / reverse proxy — required for express-rate-limit + accurate req.ip (X-Forwarded-For)
app.set("trust proxy", 1);

const PORT = process.env.PORT || 5050;
const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/book8-core";

if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
  console.warn("[book8-core-api] MONGODB_URI not set — using local fallback");
}

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
const corsOrigins = process.env.CORS_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) || [];
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
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

const businessesHttpRouter = createBusinessesHttpRouter({
  requireApiKey,
  requireInternalSecretOrApiKey,
  requireInternalAuth,
  strictLimiter,
  handleGetBusinessReviews
});

const aggregateRouter = createAggregateRouter({ requireApiKey });

// ---------- ROUTES ----------
app.use(rootHealthRouter);

// BOO-65A: Mount /api/businesses BEFORE any app.use("/api", ...). Otherwise every
// /api/businesses/* request hits the generic /api routers first; if those sub-routers
// do not forward correctly, core business routes never run (404 in production).
// BOO-67A: /aggregate/* must mount before /:id routes on the same prefix.
// BOO-84A: /:id/services/sync must register before generic /:id routes.
app.use("/api/businesses", createBusinessServicesSyncRouter(requireApiKey));
app.use("/api/businesses", aggregateRouter);
app.use("/api/businesses", businessesHttpRouter);
app.use("/api/businesses", businessLogoRouter);
app.use("/api/businesses", businessPortfolioRouter);
app.use("/api/businesses", providersRouter);
app.use("/api/businesses", noShowBusinessRouter);
app.use("/api/businesses", waitlistRouter);

app.use("/api", createApiOnboardingRouter({ requireApiKey }));
app.use("/api", categoriesRouter);

app.use("/api/calendar", calendarRouter);
app.use("/api/places", placesRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/bookings", bookingNoShowExtras);
app.use("/api/bookings", bookingsRouter);
app.use("/api/twilio", twilioInboundRouter);
app.use("/api/elevenlabs", elevenLabsWebhookRouter);
// BOO-43A: rate-limit cron + internal routes (shared strictLimiter instance)
app.use("/api/cron", strictLimiter, cronRouter);
// BOO-CANCEL-1A: hard-delete sweep for soft-deleted businesses
app.use("/api/cron", strictLimiter, hardDeleteSoftDeletedRouter);

app.use("/internal/calls", strictLimiter, requireInternalAuth, internalCallsRouter);
app.use("/internal/usage", strictLimiter, requireInternalAuth, internalUsageRouter);
app.use("/internal/bookings", strictLimiter, requireInternalAuth, internalBookingsRouter);
app.use("/internal/business", strictLimiter, requireInternalAuth, internalBusinessRouter);
app.use("/internal/execute-tool", strictLimiter, requireInternalAuth, internalExecuteToolRouter);
app.use("/internal/provision-from-stripe", strictLimiter, requireInternalAuth, internalProvisionRouter);
app.use("/internal/subscription-sync", strictLimiter, requireInternalAuth, internalSubscriptionSyncRouter);
app.use("/api/health", requireInternalAuth, healthCheckRouter);
app.use("/internal/twilio-pool", strictLimiter, requireInternalAuth, twilioPoolRouter);

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

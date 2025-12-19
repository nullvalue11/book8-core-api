// index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import { Business } from "./models/Business.js";
import { classifyBusinessCategory } from "./services/categoryClassifier.js";

const app = express();

const PORT = process.env.PORT || 5050;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/book8_core";

// ---------- DB CONNECTION ----------
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("[book8-core-api] Connected to MongoDB"))
  .catch((err) => {
    console.error("[book8-core-api] MongoDB connection error:", err);
    process.exit(1);
  });

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

    const business = await Business.findOne({ phoneNumber: normalizedTo }).lean();

    if (!business) {
      return res.status(404).json({
        ok: false,
        error: "No business found for this phone number",
        to: normalizedTo
      });
    }

    res.json({ ok: true, business });
  } catch (err) {
    console.error("Error in GET /api/resolve:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- GET BUSINESS BY ID ----------
app.get("/api/businesses/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const business = await Business.findOne({ id }).lean();

    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    res.json({ ok: true, business });
  } catch (err) {
    console.error("Error in GET /api/businesses/:id:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
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

    // Normalize phone number to E.164 format
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    const update = {
      id,
      name,
      description,
      category: finalCategory,
      timezone,
      phoneNumber: normalizedPhoneNumber,
      email,
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
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ---------- START SERVER ----------
app.listen(PORT, () => {
  console.log(`[book8-core-api] Listening on port ${PORT}`);
});

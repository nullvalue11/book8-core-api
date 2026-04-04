/**
 * BOO-54A: Google Places (New) — autocomplete, details, photo proxy.
 */
import express from "express";
import rateLimit from "express-rate-limit";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import {
  placesAutocomplete,
  placeDetails,
  fetchPlacePhoto,
  isGooglePlacesConfigured
} from "../../services/googlePlacesApi.js";

const router = express.Router();

const photoProxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" }
});

function photoProxyUrl(reference, maxwidth) {
  const q = new URLSearchParams();
  q.set("reference", reference);
  if (maxwidth) q.set("maxwidth", String(maxwidth));
  return `/api/places/photo?${q.toString()}`;
}

/** GET /api/places/autocomplete?query=&type=establishment */
router.get("/autocomplete", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    if (!isGooglePlacesConfigured()) {
      return res.status(503).json({ ok: false, error: "Google Places is not configured" });
    }
    const query = req.query.query;
    const type = req.query.type || "establishment";
    const r = await placesAutocomplete(query, type);
    if (!r.ok) {
      return res.status(400).json({ ok: false, error: r.error });
    }
    return res.json({ ok: true, predictions: r.predictions });
  } catch (err) {
    console.error("[places] autocomplete", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** GET /api/places/details?placeId= */
router.get("/details", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    if (!isGooglePlacesConfigured()) {
      return res.status(503).json({ ok: false, error: "Google Places is not configured" });
    }
    const placeId = req.query.placeId;
    const r = await placeDetails(placeId);
    if (!r.ok) {
      return res.status(400).json({ ok: false, error: r.error });
    }
    const p = r.place;
    const photos = (p.photos || []).map((ph) => ({
      reference: ph.reference,
      url: photoProxyUrl(ph.reference, 800),
      width: ph.width,
      height: ph.height
    }));
    return res.json({
      ok: true,
      placeId: p.placeId,
      name: p.name,
      address: p.address,
      phone: p.phone,
      website: p.website,
      rating: p.rating,
      reviewCount: p.reviewCount,
      photos,
      hours: p.hours,
      location: p.location,
      category: p.category,
      googleMapsUrl: p.googleMapsUrl
    });
  } catch (err) {
    console.error("[places] details", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** GET /api/places/photo?reference=&maxwidth=800 — public proxy */
router.get("/photo", photoProxyLimiter, async (req, res) => {
  try {
    if (!isGooglePlacesConfigured()) {
      return res.status(503).send("Places photo unavailable");
    }
    const reference = req.query.reference;
    const maxwidth = req.query.maxwidth || req.query.maxWidthPx;
    if (!reference || typeof reference !== "string") {
      return res.status(400).send("Missing reference");
    }
    const r = await fetchPlacePhoto(reference, maxwidth);
    if (!r.ok) {
      return res.status(r.status || 502).send(r.error || "Photo error");
    }
    res.setHeader("Content-Type", r.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(r.buffer);
  } catch (err) {
    console.error("[places] photo", err);
    return res.status(500).send("Internal error");
  }
});

export default router;

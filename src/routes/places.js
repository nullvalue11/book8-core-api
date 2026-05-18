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

/** GET /api/places/photo?reference=&maxwidth=600 — public proxy (Places API New) */
router.get("/photo", photoProxyLimiter, async (req, res) => {
  try {
    const reference = req.query.reference;
    const maxwidth = req.query.maxwidth || req.query.maxWidthPx;

    if (!reference || typeof reference !== "string") {
      return res.status(400).json({ error: "missing_reference" });
    }

    if (!reference.startsWith("places/") || !reference.includes("/photos/")) {
      console.warn(
        "[places/photo] rejected legacy or malformed reference:",
        reference.slice(0, 80)
      );
      return res.status(400).json({ error: "invalid_reference_format" });
    }

    if (!isGooglePlacesConfigured()) {
      console.error("[places/photo] no Google Maps API key configured");
      return res.status(500).json({ error: "server_misconfigured" });
    }

    const r = await fetchPlacePhoto(reference, maxwidth);
    if (!r.ok) {
      const status = r.status || 502;
      const body = {
        error: r.error || "google_photo_fetch_failed",
        ...(r.upstream_status != null && { upstream_status: r.upstream_status })
      };
      return res.status(status).json(body);
    }

    res.setHeader("Content-Type", r.contentType);
    res.setHeader(
      "Cache-Control",
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000"
    );
    return res.send(r.buffer);
  } catch (err) {
    console.error("[places/photo] unexpected error:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;

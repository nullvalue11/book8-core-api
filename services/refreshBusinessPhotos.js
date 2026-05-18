/**
 * BOO-PHOTO-REFRESH-1A — Refresh Google Places photo references when they go stale.
 */

import { Business } from "../models/Business.js";
import { placeDetails, isGooglePlacesConfigured } from "./googlePlacesApi.js";
import {
  businessLookupFilter,
  canonicalBusinessId
} from "./provisioningHelpers.js";

/**
 * @param {number} status
 * @param {string} bodyText
 */
export function isStaleGooglePhotoReferenceError(status, bodyText) {
  const t = String(bodyText ?? "").toLowerCase();
  return (
    status === 400 &&
    (t.includes("photo resource in the request is invalid") ||
      t.includes("retrieve it from places api"))
  );
}

/**
 * @param {string} reference
 * @returns {Promise<string | null>} business id slug
 */
export async function findBusinessIdByPhotoReference(reference) {
  if (!reference || typeof reference !== "string") return null;
  const ref = reference.trim();
  const biz = await Business.findOne({ "googlePlaces.photos.reference": ref })
    .select("id businessId")
    .lean();
  return canonicalBusinessId(biz);
}

/**
 * Re-fetch photo references from Google Places (New) and persist on the business.
 * @param {string} businessId
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function refreshBusinessPhotos(businessId, opts = {}) {
  const { dryRun = false } = opts;
  const doc = await Business.findOne(businessLookupFilter(businessId));
  if (!doc) {
    return { success: false, reason: "business_not_found", businessId };
  }

  const canonicalId = canonicalBusinessId(doc);
  const placeId = doc.googlePlaces?.placeId?.trim();
  if (!placeId) {
    return { success: false, reason: "no_placeId", businessId: canonicalId };
  }

  if (!isGooglePlacesConfigured()) {
    return { success: false, reason: "no_api_key", businessId: canonicalId };
  }

  const r = await placeDetails(placeId);
  if (!r.ok) {
    return {
      success: false,
      reason: "google_error",
      businessId: canonicalId,
      error: r.error
    };
  }

  const photos = (r.place.photos || []).slice(0, 15).map((p) => ({
    reference: p.reference,
    width: p.width ?? undefined,
    height: p.height ?? undefined
  }));

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      businessId: canonicalId,
      placeId,
      photoCount: photos.length,
      sampleReference: photos[0]?.reference?.slice(0, 40) ?? null
    };
  }

  const refreshedAt = new Date();
  if (!doc.googlePlaces) {
    doc.googlePlaces = {};
  }
  doc.googlePlaces.placeId = r.place.placeId || placeId;
  doc.googlePlaces.photos = photos;
  doc.googlePlaces.photosRefreshedAt = refreshedAt;
  doc.googlePlaces.lastSynced = refreshedAt;
  if (r.place.rating != null) doc.googlePlaces.rating = r.place.rating;
  if (r.place.reviewCount != null) doc.googlePlaces.reviewCount = r.place.reviewCount;
  if (r.place.location) doc.googlePlaces.location = r.place.location;
  if (r.place.googleMapsUrl) doc.googlePlaces.googleMapsUrl = r.place.googleMapsUrl;

  doc.markModified("googlePlaces");
  await doc.save();

  console.log("[refreshBusinessPhotos] updated", {
    businessId: canonicalId,
    photoCount: photos.length,
    photosRefreshedAt: refreshedAt.toISOString()
  });

  return {
    success: true,
    businessId: canonicalId,
    photoCount: photos.length,
    photosRefreshedAt: refreshedAt
  };
}

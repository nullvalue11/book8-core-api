/**
 * BOO-54A: merge Google Places details into Business without overwriting owner data.
 * @param {import("mongoose").Document} doc
 * @param {object} place - shape from {@link import("./googlePlacesApi.js").placeDetails} `.place`
 */
export function mergeBusinessProfileFromPlace(doc, place) {
  if (!place) return;

  if (!doc.businessProfile) {
    doc.businessProfile = {};
  }
  const bp = doc.businessProfile;

  const addr = bp.address;
  const hasOwnerAddress =
    addr &&
    (String(addr.street || "").trim() ||
      String(addr.city || "").trim() ||
      String(addr.province || "").trim() ||
      String(addr.country || "").trim() ||
      String(addr.postalCode || "").trim());

  if (!hasOwnerAddress && place.address) {
    if (!bp.address) bp.address = {};
    const a = place.address;
    if (a.street) bp.address.street = a.street;
    if (a.city) bp.address.city = a.city;
    if (a.province) bp.address.province = a.province;
    if (a.postalCode) bp.address.postalCode = a.postalCode;
    if (a.country) bp.address.country = a.country;
  }

  const phoneSet = bp.phone && String(bp.phone).trim();
  if (!phoneSet && place.phone) {
    bp.phone = place.phone;
  }

  const webSet = bp.website && String(bp.website).trim();
  if (!webSet && place.website) {
    bp.website = place.website;
  }
}

export function applyGooglePlacesToBusiness(doc, place) {
  mergeBusinessProfileFromPlace(doc, place);

  doc.googlePlaces = {
    placeId: place.placeId,
    rating: place.rating,
    reviewCount: place.reviewCount,
    photos: (place.photos || []).slice(0, 15).map((p) => ({
      reference: p.reference,
      width: p.width ?? undefined,
      height: p.height ?? undefined
    })),
    location: place.location || undefined,
    googleMapsUrl: place.googleMapsUrl || undefined,
    lastSynced: new Date()
  };
}

/**
 * BOO-54A: strip internal fields for public booking page JSON.
 */
export function toPublicGooglePlaces(googlePlaces) {
  if (!googlePlaces || typeof googlePlaces !== "object") {
    return undefined;
  }
  const photos = Array.isArray(googlePlaces.photos)
    ? googlePlaces.photos.map((p) => ({
        reference: p.reference,
        width: p.width ?? null,
        height: p.height ?? null
      }))
    : [];
  return {
    rating: googlePlaces.rating ?? null,
    reviewCount: googlePlaces.reviewCount ?? null,
    photos,
    location: googlePlaces.location || null,
    googleMapsUrl: googlePlaces.googleMapsUrl || null
  };
}

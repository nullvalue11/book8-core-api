/**
 * Google Places API (New) — server-side only. Uses GOOGLE_PLACES_API_KEY.
 * @see https://developers.google.com/maps/documentation/places/web-service/op-overview
 */

const PLACES_BASE = "https://places.googleapis.com/v1";

function apiKey() {
  return process.env.GOOGLE_PLACES_API_KEY || "";
}

export function isGooglePlacesConfigured() {
  return !!apiKey();
}

/**
 * @param {string} query
 * @param {string} [primaryType] e.g. "establishment" — may be ignored if not a valid primary type in new API
 */
export async function placesAutocomplete(query, primaryType) {
  const key = apiKey();
  if (!key) {
    return { ok: false, error: "GOOGLE_PLACES_API_KEY is not configured" };
  }
  const input = typeof query === "string" ? query.trim() : "";
  if (!input) {
    return { ok: false, error: "query is required" };
  }

  const body = {
    input,
    languageCode: "en",
    regionCode: "US"
  };
  if (primaryType) {
    body.includedPrimaryTypes = [primaryType];
  } else {
    body.includedPrimaryTypes = ["establishment"];
  }

  try {
    const res = await fetch(`${PLACES_BASE}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText || "Autocomplete failed";
      console.error("[googlePlaces] autocomplete:", res.status, msg);
      return { ok: false, error: msg };
    }

    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    const predictions = [];
    for (const s of suggestions) {
      const pp = s.placePrediction;
      if (!pp) continue;
      const placeId = pp.placeId || "";
      const textObj = pp.text || {};
      const mainText = textObj.text || "";
      const secondary =
        pp.structuredFormat?.secondaryText?.text ||
        pp.structuredFormat?.mainText?.text ||
        "";
      const address = secondary || mainText;
      predictions.push({
        placeId,
        name: mainText || placeId,
        address: address || "",
        types: Array.isArray(pp.types) ? pp.types : []
      });
      if (predictions.length >= 5) break;
    }

    return { ok: true, predictions };
  } catch (err) {
    console.error("[googlePlaces] autocomplete:", err);
    return { ok: false, error: err.message || "Autocomplete request failed" };
  }
}

const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "location",
  "rating",
  "userRatingCount",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "regularOpeningHours",
  "photos",
  "googleMapsUri",
  "types"
].join(",");

function mapAddressComponents(components, formattedFallback) {
  const out = {
    street: "",
    city: "",
    province: "",
    postalCode: "",
    country: "",
    formatted: formattedFallback || ""
  };
  if (!Array.isArray(components)) return out;
  const get = (t) => {
    const c = components.find((x) => Array.isArray(x.types) && x.types.includes(t));
    return c?.longText || c?.shortText || "";
  };
  const streetNumber = get("street_number");
  const route = get("route");
  out.street = [streetNumber, route].filter(Boolean).join(" ").trim();
  out.city =
    get("locality") ||
    get("sublocality") ||
    get("administrative_area_level_2") ||
    "";
  out.province = get("administrative_area_level_1") || "";
  out.postalCode = get("postal_code") || "";
  out.country = get("country") || "";
  if (!out.formatted) out.formatted = formattedFallback || "";
  return out;
}

/** Google weekday: 0 = Sunday … 6 = Saturday */
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function timeFromPoint(p) {
  if (!p) return null;
  return `${pad2(p.hour ?? 0)}:${pad2(p.minute ?? 0)}`;
}

/**
 * Build monday…sunday hours from regularOpeningHours.periods
 */
function mapOpeningHours(regular) {
  const hours = {};
  for (const d of DAY_KEYS) {
    hours[d] = { open: "09:00", close: "17:00", isOpen: false };
  }
  const periods = regular?.periods;
  if (!Array.isArray(periods) || periods.length === 0) {
    return hours;
  }

  for (const p of periods) {
    const open = p.open;
    const close = p.close;
    if (!open || open.day == null) continue;
    const dayKey = DAY_KEYS[open.day];
    if (!dayKey) continue;
    const openStr = timeFromPoint(open);
    const closeStr = close ? timeFromPoint(close) : "23:59";
    if (openStr) {
      hours[dayKey] = {
        open: openStr,
        close: closeStr || "23:59",
        isOpen: true
      };
    }
  }
  return hours;
}

/**
 * @param {string} placeId - ChIJ… style ID
 */
export async function placeDetails(placeId) {
  const key = apiKey();
  if (!key) {
    return { ok: false, error: "GOOGLE_PLACES_API_KEY is not configured" };
  }
  const id = typeof placeId === "string" ? placeId.trim() : "";
  if (!id) {
    return { ok: false, error: "placeId is required" };
  }

  const pathId = encodeURIComponent(id);

  try {
    const res = await fetch(`${PLACES_BASE}/places/${pathId}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText || "Place details failed";
      console.error("[googlePlaces] details:", res.status, msg);
      return { ok: false, error: msg };
    }

    const name = data.displayName?.text || data.name || "";
    const formatted = data.formattedAddress || "";
    const addr = mapAddressComponents(data.addressComponents, formatted);

    const phone = data.internationalPhoneNumber || data.nationalPhoneNumber || "";
    const website = data.websiteUri || "";

    const rating = typeof data.rating === "number" ? data.rating : null;
    const reviewCount =
      typeof data.userRatingCount === "number" ? data.userRatingCount : typeof data.userRatingCount === "string"
        ? parseInt(data.userRatingCount, 10)
        : null;

    const loc = data.location;
    const location =
      loc && typeof loc.latitude === "number" && typeof loc.longitude === "number"
        ? { lat: loc.latitude, lng: loc.longitude }
        : null;

    const types = Array.isArray(data.types) ? data.types : [];
    const category = types.find((t) => t && t !== "point_of_interest" && t !== "establishment") || types[0] || "";

    const photos = [];
    const photoList = Array.isArray(data.photos) ? data.photos : [];
    for (const ph of photoList.slice(0, 10)) {
      const nameRef = ph.name || "";
      if (!nameRef) continue;
      photos.push({
        reference: nameRef,
        width: ph.widthPx ?? ph.width ?? null,
        height: ph.heightPx ?? ph.height ?? null
      });
    }

    const hours = mapOpeningHours(data.regularOpeningHours);

    const googleMapsUrl = data.googleMapsUri || "";

    return {
      ok: true,
      place: {
        placeId: id,
        name,
        address: {
          street: addr.street,
          city: addr.city,
          province: addr.province,
          postalCode: addr.postalCode,
          country: addr.country,
          formatted: addr.formatted || formatted
        },
        phone,
        website,
        rating,
        reviewCount,
        photos,
        hours,
        location,
        category,
        googleMapsUrl
      }
    };
  } catch (err) {
    console.error("[googlePlaces] details:", err);
    return { ok: false, error: err.message || "Place details request failed" };
  }
}

/**
 * Fetch raw photo bytes from Places API (New). `reference` is the photo resource name (places/.../photos/...).
 */
export async function fetchPlacePhoto(reference, maxWidthPx) {
  const key = apiKey();
  if (!key) {
    return { ok: false, error: "GOOGLE_PLACES_API_KEY is not configured" };
  }
  if (!reference || typeof reference !== "string") {
    return { ok: false, error: "reference is required" };
  }

  const mw = Math.min(Math.max(Number(maxWidthPx) || 800, 1), 4800);
  const pathSegs = String(reference)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  try {
    const url = `${PLACES_BASE}/${pathSegs}/media?maxWidthPx=${mw}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-Goog-Api-Key": key }
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[googlePlaces] photo:", res.status, t?.slice(0, 200));
      return { ok: false, error: "Photo fetch failed", status: res.status };
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer: buf, contentType };
  } catch (err) {
    console.error("[googlePlaces] photo:", err);
    return { ok: false, error: err.message || "Photo request failed" };
  }
}

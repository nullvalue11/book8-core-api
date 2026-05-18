/**
 * Google Places API (New) — server-side only.
 * @see https://developers.google.com/maps/documentation/places/web-service/op-overview
 */

const PLACES_BASE = "https://places.googleapis.com/v1";

/** Prefer MAPS keys first — Render often still has an expired GOOGLE_PLACES_API_KEY set. */
const API_KEY_ENV_PRIORITY = [
  "GOOGLE_MAPS_API_KEY",
  "GOOGLE_MAPS_SERVER_KEY",
  "GOOGLE_PLACES_API_KEY"
];

/**
 * Distinct configured keys in priority order (for fallback when one key is expired).
 * @returns {Array<{ env: string, key: string }>}
 */
export function configuredGoogleApiKeys() {
  const seen = new Set();
  const out = [];
  for (const env of API_KEY_ENV_PRIORITY) {
    const raw = process.env[env];
    const key = typeof raw === "string" ? raw.trim() : "";
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({ env, key });
    }
  }
  return out;
}

function apiKey() {
  return configuredGoogleApiKeys()[0]?.key ?? "";
}

function isGoogleApiKeyError(status, bodyText) {
  const t = String(bodyText ?? "").toLowerCase();
  if (status === 401 || status === 403) return true;
  if (status === 400 && (t.includes("api key") || t.includes("apikey") || t.includes("expired"))) {
    return true;
  }
  return false;
}

/**
 * @param {(key: string, keyEnv: string) => Promise<Response>} requestFn
 * @param {string} logTag
 */
async function fetchWithGoogleApiKeyFallback(requestFn, logTag) {
  const keys = configuredGoogleApiKeys();
  if (keys.length === 0) {
    return { ok: false, error: "server_misconfigured", status: 500 };
  }

  let lastFailure = null;
  for (let i = 0; i < keys.length; i++) {
    const { env, key } = keys[i];
    const res = await requestFn(key, env);
    if (res.ok) {
      if (i > 0) {
        console.log(`[googlePlaces] ${logTag} succeeded with ${env} after earlier key rejection`);
      }
      return { ok: true, res, keyEnv: env };
    }

    const text = await res.text().catch(() => "");
    if (isGoogleApiKeyError(res.status, text) && i < keys.length - 1) {
      console.warn(
        `[googlePlaces] ${logTag} ${env} rejected (${res.status}): ${text.slice(0, 160)} — trying next key`
      );
      lastFailure = { status: res.status, text, env };
      continue;
    }

    return { ok: false, res, text, keyEnv: env, lastFailure };
  }

  return {
    ok: false,
    error: "google_api_key_failed",
    status: 502,
    text: lastFailure?.text ?? "",
    keyEnv: lastFailure?.env
  };
}

export function isGooglePlacesConfigured() {
  return configuredGoogleApiKeys().length > 0;
}

/**
 * @param {string} query
 * @param {string} [primaryType] e.g. "establishment" — may be ignored if not a valid primary type in new API
 */
export async function placesAutocomplete(query, primaryType) {
  if (!isGooglePlacesConfigured()) {
    return { ok: false, error: "Google Places API key is not configured" };
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
    const attempt = await fetchWithGoogleApiKeyFallback(
      (key) =>
        fetch(`${PLACES_BASE}/places:autocomplete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key
          },
          body: JSON.stringify(body)
        }),
      "autocomplete"
    );
    if (!attempt.ok) {
      const msg =
        attempt.error ||
        attempt.text?.slice(0, 200) ||
        "Autocomplete failed";
      console.error("[googlePlaces] autocomplete:", attempt.lastFailure?.status ?? 502, msg);
      return { ok: false, error: msg };
    }

    const res = attempt.res;
    const data = await res.json().catch(() => ({}));

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
  if (!isGooglePlacesConfigured()) {
    return { ok: false, error: "Google Places API key is not configured" };
  }
  const id = typeof placeId === "string" ? placeId.trim() : "";
  if (!id) {
    return { ok: false, error: "placeId is required" };
  }

  const pathId = encodeURIComponent(id);

  try {
    const attempt = await fetchWithGoogleApiKeyFallback(
      (key) =>
        fetch(`${PLACES_BASE}/places/${pathId}`, {
          method: "GET",
          headers: {
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": DETAILS_FIELD_MASK
          }
        }),
      "details"
    );
    if (!attempt.ok) {
      const msg = attempt.text?.slice(0, 200) || attempt.error || "Place details failed";
      console.error("[googlePlaces] details:", attempt.lastFailure?.status ?? 502, msg);
      return { ok: false, error: msg };
    }

    const res = attempt.res;
    const data = await res.json().catch(() => ({}));

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
  if (!isGooglePlacesConfigured()) {
    return { ok: false, error: "server_misconfigured", status: 500 };
  }

  const ref = typeof reference === "string" ? reference.trim() : "";
  if (!ref) {
    return { ok: false, error: "missing_reference", status: 400 };
  }
  if (!ref.startsWith("places/") || !ref.includes("/photos/")) {
    return { ok: false, error: "invalid_reference_format", status: 400 };
  }

  const widthParam = parseInt(maxWidthPx, 10);
  const mw = Number.isFinite(widthParam) ? Math.min(Math.max(widthParam, 1), 4800) : 600;

  try {
    const googleUrl = `${PLACES_BASE}/${ref}/media?maxWidthPx=${mw}&skipHttpRedirect=true`;
    const attempt = await fetchWithGoogleApiKeyFallback(
      (key) =>
        fetch(googleUrl, {
          method: "GET",
          headers: { "X-Goog-Api-Key": key }
        }),
      "photo"
    );

    if (!attempt.ok) {
      const text = attempt.text || "";
      const upstreamStatus = attempt.lastFailure?.status ?? attempt.res?.status ?? 502;
      if (
        upstreamStatus === 400 &&
        (text.includes("photo resource in the request is invalid") ||
          text.toLowerCase().includes("retrieve it from places api"))
      ) {
        return {
          ok: false,
          error: "photo_reference_stale",
          status: 410,
          stale: true,
          upstream_status: upstreamStatus
        };
      }
      console.error(
        "[places/photo] Google returned",
        upstreamStatus,
        text.slice(0, 200),
        attempt.keyEnv ? `(last key: ${attempt.keyEnv})` : ""
      );
      if (attempt.error === "google_api_key_failed") {
        return {
          ok: false,
          error: "google_api_key_expired",
          status: 503,
          upstream_status: upstreamStatus
        };
      }
      return {
        ok: false,
        error: "google_photo_fetch_failed",
        status: upstreamStatus === 429 ? 429 : 502,
        upstream_status: upstreamStatus
      };
    }

    const googleRes = attempt.res;
    const data = await googleRes.json().catch(() => ({}));
    const photoUri = data.photoUri;
    if (!photoUri || typeof photoUri !== "string") {
      console.error(
        "[places/photo] no photoUri in Google response:",
        JSON.stringify(data).slice(0, 200)
      );
      return { ok: false, error: "no_photo_uri", status: 502 };
    }

    const imgRes = await fetch(photoUri);
    if (!imgRes.ok) {
      console.error("[places/photo] photoUri fetch failed:", imgRes.status, photoUri.slice(0, 80));
      return { ok: false, error: "photo_uri_fetch_failed", status: 502 };
    }

    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return { ok: true, buffer, contentType };
  } catch (err) {
    console.error("[places/photo] unexpected error:", err);
    return { ok: false, error: "internal_error", status: 500 };
  }
}

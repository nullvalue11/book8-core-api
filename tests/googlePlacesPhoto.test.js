/**
 * BOO-PLACES-PHOTOS-FIX-1A: Places (New) photo reference validation
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { configuredGoogleApiKeys, fetchPlacePhoto } from "../services/googlePlacesApi.js";

describe("configuredGoogleApiKeys", () => {
  const prev = {
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    GOOGLE_MAPS_SERVER_KEY: process.env.GOOGLE_MAPS_SERVER_KEY
  };

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("prefers GOOGLE_MAPS_API_KEY over expired GOOGLE_PLACES_API_KEY", () => {
    process.env.GOOGLE_PLACES_API_KEY = "expired-places-key";
    process.env.GOOGLE_MAPS_API_KEY = "valid-maps-key";
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const keys = configuredGoogleApiKeys();
    assert.equal(keys[0].env, "GOOGLE_MAPS_API_KEY");
    assert.equal(keys[0].key, "valid-maps-key");
    assert.equal(keys[1].env, "GOOGLE_PLACES_API_KEY");
  });
});

describe("fetchPlacePhoto", () => {
  const prevKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
  });

  after(() => {
    if (prevKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = prevKey;
  });

  it("returns missing_reference when reference is empty", async () => {
    const r = await fetchPlacePhoto("", 600);
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_reference");
    assert.equal(r.status, 400);
  });

  it("rejects legacy opaque photoreference tokens", async () => {
    const r = await fetchPlacePhoto("CmRaAAAAlegacyTokenNoSlashes", 600);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_reference_format");
    assert.equal(r.status, 400);
  });

  it("rejects malformed places paths without /photos/", async () => {
    const r = await fetchPlacePhoto("places/ChIJabc123", 600);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_reference_format");
    assert.equal(r.status, 400);
  });
});

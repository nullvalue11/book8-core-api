/**
 * BOO-PLACES-PHOTOS-FIX-1A: Places (New) photo reference validation
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { fetchPlacePhoto } from "../services/googlePlacesApi.js";

describe("fetchPlacePhoto", () => {
  const prevKey = process.env.GOOGLE_PLACES_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
  });

  after(() => {
    if (prevKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = prevKey;
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

import { describe, it } from "node:test";
import assert from "node:assert";
import { toPublicGooglePlaces } from "../src/utils/googlePlacesPublic.js";

describe("toPublicGooglePlaces (BOO-54A)", () => {
  it("strips placeId and returns safe fields", () => {
    const pub = toPublicGooglePlaces({
      placeId: "ChIJ_SECRET",
      rating: 4.5,
      reviewCount: 10,
      photos: [{ reference: "places/x/photos/y", width: 100, height: 80 }],
      location: { lat: 1, lng: 2 },
      googleMapsUrl: "https://maps.google.com/?q=1"
    });
    assert.strictEqual(pub.placeId, undefined);
    assert.strictEqual(pub.rating, 4.5);
    assert.strictEqual(pub.reviewCount, 10);
    assert.strictEqual(pub.photos[0].reference, "places/x/photos/y");
    assert.strictEqual(pub.location.lat, 1);
    assert.strictEqual(pub.googleMapsUrl.includes("maps.google"), true);
  });

  it("returns undefined for empty input", () => {
    assert.strictEqual(toPublicGooglePlaces(null), undefined);
  });
});

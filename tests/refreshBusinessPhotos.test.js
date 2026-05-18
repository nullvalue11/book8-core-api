/**
 * BOO-PHOTO-REFRESH-1A
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isStaleGooglePhotoReferenceError } from "../services/refreshBusinessPhotos.js";

describe("isStaleGooglePhotoReferenceError", () => {
  it("detects invalid photo resource message", () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: "The photo resource in the request is invalid. Please retrieve it from Places API endpoints.",
        status: "INVALID_ARGUMENT"
      }
    });
    assert.equal(isStaleGooglePhotoReferenceError(400, body), true);
  });

  it("ignores other 400 errors", () => {
    assert.equal(isStaleGooglePhotoReferenceError(400, "API key expired"), false);
    assert.equal(isStaleGooglePhotoReferenceError(502, "photo resource invalid"), false);
  });
});

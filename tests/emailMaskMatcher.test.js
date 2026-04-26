/**
 * Unit tests for isMaskedEmail (BOO-MEM-1C)
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { isMaskedEmail } from "../src/utils/emailMaskMatcher.js";

describe("isMaskedEmail (BOO-MEM-1C)", () => {
  it('returns true for 2-char local masked email: "wa***@live.ca"', () => {
    assert.strictEqual(isMaskedEmail("wa***@live.ca"), true);
  });

  it('returns true for 1-char local masked email: "a***@example.com"', () => {
    assert.strictEqual(isMaskedEmail("a***@example.com"), true);
  });

  it('returns false for real email: "waism@live.ca"', () => {
    assert.strictEqual(isMaskedEmail("waism@live.ca"), false);
  });

  it("returns false for empty string", () => {
    assert.strictEqual(isMaskedEmail(""), false);
  });

  it("returns false for null", () => {
    assert.strictEqual(isMaskedEmail(null), false);
  });

  it('returns false for non-email string: "not-an-email"', () => {
    assert.strictEqual(isMaskedEmail("not-an-email"), false);
  });

  it("returns false for undefined", () => {
    assert.strictEqual(isMaskedEmail(undefined), false);
  });

  it("returns false for a bare domain only", () => {
    assert.strictEqual(isMaskedEmail("***@live.ca"), false);
  });
});

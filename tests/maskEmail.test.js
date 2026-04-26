import { describe, it } from "node:test";
import assert from "node:assert";
import { maskEmail } from "../src/utils/maskEmail.js";

describe("maskEmail (BOO-MEM-1A)", () => {
  it("masks normal local part", () => {
    assert.strictEqual(maskEmail("waism@live.ca"), "wa***@live.ca");
  });

  it("short local: one char before @", () => {
    assert.strictEqual(maskEmail("a@b.com"), "a***@b.com");
  });

  it("returns null for missing @", () => {
    assert.strictEqual(maskEmail("notanemail"), null);
  });

  it("returns null for null/empty", () => {
    assert.strictEqual(maskEmail(null), null);
    assert.strictEqual(maskEmail(""), null);
  });
});

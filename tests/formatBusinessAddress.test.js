import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatBusinessAddress,
  resolveBusinessCity,
  getElevenLabsBusinessLocationVars
} from "../src/utils/formatBusinessAddress.js";

describe("formatBusinessAddress (BOO-85A)", () => {
  it("formats businessProfile.address as comma-separated line", () => {
    const business = {
      businessProfile: {
        address: {
          street: "5 Daly Avenue",
          city: "Ottawa",
          province: "ON",
          postalCode: "K1N 6E2",
          country: "Canada"
        }
      }
    };
    assert.strictEqual(
      formatBusinessAddress(business),
      "5 Daly Avenue, Ottawa, ON, K1N 6E2, Canada"
    );
    assert.strictEqual(resolveBusinessCity(business), "Ottawa");
  });

  it("prefers root city when set", () => {
    const business = {
      city: "Ottawa",
      businessProfile: { address: { city: "Toronto" } }
    };
    assert.strictEqual(resolveBusinessCity(business), "Ottawa");
  });

  it("returns empty strings for null business", () => {
    assert.strictEqual(formatBusinessAddress(null), "");
    assert.strictEqual(resolveBusinessCity(undefined), "");
    assert.deepStrictEqual(getElevenLabsBusinessLocationVars(null), {
      business_city: "",
      business_address: ""
    });
  });

  it("never returns null-like strings for ElevenLabs", () => {
    const business = { city: undefined, businessProfile: {} };
    const v = getElevenLabsBusinessLocationVars(business);
    assert.strictEqual(typeof v.business_city, "string");
    assert.strictEqual(typeof v.business_address, "string");
    assert.ok(v.business_city !== "undefined");
    assert.ok(v.business_address !== "null");
  });

  it("supports legacy string business.address", () => {
    assert.strictEqual(formatBusinessAddress({ address: " 123 Main St " }), "123 Main St");
  });

  it("BOO-95A: uses state when province is missing (legacy shape)", () => {
    const business = {
      businessProfile: {
        address: {
          street: "5 Daly Avenue",
          city: "Ottawa",
          state: "Ontario",
          postalCode: "K1N 9M7",
          country: "CA"
        }
      }
    };
    assert.strictEqual(resolveBusinessCity(business), "Ottawa");
    assert.ok(formatBusinessAddress(business).includes("Ontario"));
  });

  it("BOO-95A: falls back to formattedLine when structured parts are empty", () => {
    const line = "5 Daly Avenue, Ottawa, ON K1N 9M7, Canada";
    const business = {
      businessProfile: {
        address: { formattedLine: line }
      }
    };
    assert.strictEqual(formatBusinessAddress(business), line);
    assert.strictEqual(resolveBusinessCity(business), "Ottawa");
  });
});

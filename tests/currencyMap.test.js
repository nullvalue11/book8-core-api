/**
 * BOO-MULTI-CURRENCY-1A / BOO-MULTI-CURRENCY-FIX-1A
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getCurrencyForBusiness,
  getCurrencyForCountry
} from "../src/config/currencyMap.js";

describe("currencyMap", () => {
  it("getCurrencyForCountry maps AE → aed", () => {
    assert.strictEqual(getCurrencyForCountry("AE"), "aed");
  });

  it("getCurrencyForCountry maps US → usd", () => {
    assert.strictEqual(getCurrencyForCountry("US"), "usd");
  });

  it("getCurrencyForCountry maps CA → cad (home market)", () => {
    assert.strictEqual(getCurrencyForCountry("CA"), "cad");
    assert.strictEqual(getCurrencyForCountry("Canada"), "cad");
  });

  it("getCurrencyForBusiness uses country AE", () => {
    assert.strictEqual(getCurrencyForBusiness({ country: "AE" }), "aed");
  });

  it("getCurrencyForBusiness uses country US", () => {
    assert.strictEqual(getCurrencyForBusiness({ country: "US" }), "usd");
  });

  it("getCurrencyForBusiness uses country CA → cad", () => {
    assert.strictEqual(getCurrencyForBusiness({ country: "CA" }), "cad");
  });

  it("getCurrencyForBusiness defaults to usd (international fallback)", () => {
    assert.strictEqual(getCurrencyForBusiness({}), "usd");
    assert.strictEqual(getCurrencyForBusiness(null), "usd");
  });

  it("preferredCurrency overrides country", () => {
    assert.strictEqual(
      getCurrencyForBusiness({ preferredCurrency: "aed", country: "US" }),
      "aed"
    );
    assert.strictEqual(
      getCurrencyForBusiness({ preferredCurrency: "cad", country: "US" }),
      "cad"
    );
  });

  it("derives AE from +971 phone", () => {
    assert.strictEqual(getCurrencyForBusiness({ phoneNumber: "+971501234567" }), "aed");
  });
});

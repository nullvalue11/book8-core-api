import test from "node:test";
import assert from "node:assert/strict";

import {
  mapCountryNameToCode,
  resolveBusinessCountryIso,
  inferCountryIsoFromE164,
  regionForCountry
} from "../src/utils/countryCodes.js";

test("mapCountryNameToCode handles names and ISO", () => {
  assert.equal(mapCountryNameToCode("United Arab Emirates"), "AE");
  assert.equal(mapCountryNameToCode("UAE"), "AE");
  assert.equal(mapCountryNameToCode("ca"), "CA");
  assert.equal(mapCountryNameToCode("AE"), "AE");
});

test("inferCountryIsoFromE164 NANP CA vs US", () => {
  assert.equal(inferCountryIsoFromE164("+16475550100"), "CA");
  assert.equal(inferCountryIsoFromE164("+12025550123"), "US");
});

test("inferCountryIsoFromE164 UAE", () => {
  assert.equal(inferCountryIsoFromE164("+971501234567"), "AE");
});

test("resolveBusinessCountryIso reads profile address", () => {
  assert.equal(
    resolveBusinessCountryIso({
      businessProfile: { address: { country: "United Arab Emirates" } }
    }),
    "AE"
  );
});

test("regionForCountry buckets", () => {
  assert.equal(regionForCountry("AE"), "MiddleEast");
  assert.equal(regionForCountry("US"), "NorthAmerica");
});

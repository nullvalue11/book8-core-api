import test from "node:test";
import assert from "node:assert/strict";

import { pickAvailableTwilioNumber } from "../services/twilioPoolSelection.js";

test("pickAvailableTwilioNumber prefers exact country match", () => {
  const rows = [
    { phoneNumber: "+12025550123", country: "US" },
    { phoneNumber: "+971501234567", country: "AE" },
    { phoneNumber: "+16475550100", country: "CA" }
  ];
  const r = pickAvailableTwilioNumber(rows, "AE");
  assert.equal(r.tier, "country");
  assert.equal(r.doc.country, "AE");
});

test("pickAvailableTwilioNumber falls back within region", () => {
  const rows = [
    { phoneNumber: "+966501234567", country: "SA" },
    { phoneNumber: "+16475550100", country: "CA" }
  ];
  const r = pickAvailableTwilioNumber(rows, "AE");
  assert.equal(r.tier, "continent");
  assert.equal(r.doc.country, "SA");
});

test("pickAvailableTwilioNumber global last resort", () => {
  const rows = [{ phoneNumber: "+61400000000", country: "AU" }];
  const r = pickAvailableTwilioNumber(rows, "AE");
  assert.equal(r.tier, "global");
  assert.equal(r.doc.country, "AU");
});

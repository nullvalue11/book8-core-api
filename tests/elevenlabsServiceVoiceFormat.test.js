/**
 * BOO-75A — services_list / services_json include pricing for ElevenLabs agent.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildServicesDetailForElevenLabs,
  buildServicesListForElevenLabs,
  formatServiceLineForElevenLabs,
  embeddedBusinessServicesAsVoiceList
} from "../src/utils/elevenlabsServiceVoiceFormat.js";

describe("elevenlabsServiceVoiceFormat (BOO-75A)", () => {
  it("includes price and duration in list line", () => {
    const line = formatServiceLineForElevenLabs({
      serviceId: "cleaning",
      name: "Full Detail Wash",
      durationMinutes: 60,
      price: 45,
      currency: "USD"
    });
    assert.match(line, /Full Detail Wash/);
    assert.match(line, /\$45/);
    assert.match(line, /60 minutes/);
    assert.match(line, /serviceId: cleaning/);
  });

  it("uses complimentary wording for zero price", () => {
    const line = formatServiceLineForElevenLabs({
      serviceId: "c",
      name: "Consultation",
      durationMinutes: 15,
      price: 0
    });
    assert.match(line, /complimentary/);
    assert.doesNotMatch(line, /\$0/);
  });

  it("does not invent price when missing", () => {
    const line = formatServiceLineForElevenLabs({
      serviceId: "x",
      name: "Mystery Service",
      durationMinutes: 30,
      price: null
    });
    assert.match(line, /confirm pricing/);
  });

  it("buildServicesListForElevenLabs joins with semicolons", () => {
    const list = buildServicesListForElevenLabs([
      {
        serviceId: "a",
        name: "Basic Wash",
        durationMinutes: 30,
        price: 20,
        currency: "USD"
      },
      {
        serviceId: "b",
        name: "Full Detail",
        durationMinutes: 60,
        price: 80,
        currency: "USD"
      }
    ]);
    assert.ok(list.includes(";"));
    assert.match(list, /\$20/);
    assert.match(list, /\$80/);
  });

  it("buildServicesDetailForElevenLabs carries price and pricingNote", () => {
    const rows = buildServicesDetailForElevenLabs([
      { serviceId: "a", name: "Priced", durationMinutes: 60, price: 100, currency: "CAD" },
      { serviceId: "b", name: "TBD", durationMinutes: 30, price: null }
    ]);
    assert.strictEqual(rows[0].price, 100);
    assert.strictEqual(rows[0].currency, "CAD");
    assert.ok(rows[1].pricingNote);
    assert.strictEqual(rows[1].price, null);
  });

  it("embeddedBusinessServicesAsVoiceList maps legacy Business.services shape", () => {
    const out = embeddedBusinessServicesAsVoiceList({
      services: [
        { id: "cl", name: "Clean", duration: 45, price: 35, active: true }
      ]
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].serviceId, "cl");
    assert.strictEqual(out[0].durationMinutes, 45);
    assert.strictEqual(out[0].price, 35);
  });
});

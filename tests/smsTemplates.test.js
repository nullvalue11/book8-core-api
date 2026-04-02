/**
 * BOO-34A: short confirmation copy + CANCEL BOOKING in English for all locales.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { getSmsTemplate } from "../services/templates/smsTemplates.js";

describe("SMS confirmation templates (BOO-34A)", () => {
  const data = {
    businessName: "Test Salon",
    date: "March 17",
    time: "2:00 PM",
    serviceName: "Cut",
    customerName: "Alex"
  };

  for (const lang of ["en", "fr", "es", "ar"]) {
    it(`${lang} confirmation includes CANCEL BOOKING and businessName`, () => {
      const fn = getSmsTemplate(lang, "confirmation");
      const text = fn(data);
      assert.ok(text.includes("CANCEL BOOKING"));
      assert.ok(text.includes("Test Salon"));
      assert.ok(!text.includes("Google") && !text.includes("Outlook"));
    });
  }
});

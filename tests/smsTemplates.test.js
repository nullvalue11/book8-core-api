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

describe("SMS waitlist templates (BOO-59A)", () => {
  const joinData = { businessName: "Salon", serviceName: "Cut" };
  const slotData = {
    businessName: "Salon",
    serviceName: "Cut",
    date: "June 1",
    time: "2:00 PM",
    link: "https://www.book8.io/b/x"
  };
  const expData = {
    businessName: "Salon",
    serviceName: "Cut",
    bookingLink: "https://www.book8.io/b/x"
  };
  for (const lang of ["en", "fr", "es", "ar"]) {
    it(`${lang} waitlistJoin mentions business`, () => {
      const fn = getSmsTemplate(lang, "waitlistJoin");
      const text = fn(joinData);
      assert.ok(text.includes("Salon"));
    });
    it(`${lang} waitlistSlotOpen includes link`, () => {
      const fn = getSmsTemplate(lang, "waitlistSlotOpen");
      const text = fn(slotData);
      assert.ok(text.includes(slotData.link));
    });
    it(`${lang} waitlistExpired includes booking page`, () => {
      const fn = getSmsTemplate(lang, "waitlistExpired");
      const text = fn(expData);
      assert.ok(text.includes("book8.io"));
    });
  }
});

describe("SMS review request templates (BOO-58A)", () => {
  const data = {
    serviceName: "Massage",
    businessName: "Spa Co",
    link: "https://www.book8.io/review/tok"
  };
  for (const lang of ["en", "fr", "es", "ar"]) {
    it(`${lang} reviewRequest includes link and service`, () => {
      const fn = getSmsTemplate(lang, "reviewRequest");
      const text = fn(data);
      assert.ok(text.includes(data.link));
      assert.ok(text.includes("Massage"));
      assert.ok(text.includes("Spa Co"));
    });
  }
});

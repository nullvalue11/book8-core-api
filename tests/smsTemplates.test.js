/**
 * BOO-34A: short confirmation copy + CANCEL BOOKING in English for all locales.
 * BOO-SMS-COMPLIANCE-1A: TCPA / CTIA / Infobip 10DLC required disclosures
 *   (STOP opt-out, HELP support, "Msg&data rates", business + service name).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { getSmsTemplate } from "../services/templates/smsTemplates.js";

describe("SMS confirmation templates (BOO-34A / BOO-SMS-COMPLIANCE-1A)", () => {
  const data = {
    businessName: "Diamond Car Wash Rideau",
    date: "Fri May 15, 2026",
    time: "3:00 PM",
    serviceName: "Full Wash - Interior and Exterior",
    customerName: "Alex"
  };

  for (const lang of ["en", "fr", "es", "ar"]) {
    it(`${lang} confirmation includes business + service + CANCEL BOOKING + STOP + HELP + msg&data + date/time`, () => {
      const fn = getSmsTemplate(lang, "confirmation");
      const text = fn(data);
      assert.ok(text.includes("CANCEL BOOKING"), `${lang}: missing CANCEL BOOKING`);
      assert.ok(text.includes("STOP"), `${lang}: missing STOP`);
      assert.ok(text.includes("HELP"), `${lang}: missing HELP`);
      assert.ok(text.includes("Diamond Car Wash Rideau"), `${lang}: missing businessName`);
      assert.ok(
        text.includes("Full Wash - Interior and Exterior"),
        `${lang}: missing serviceName`
      );
      assert.ok(text.includes("Fri May 15, 2026"), `${lang}: missing date`);
      assert.ok(text.includes("3:00 PM"), `${lang}: missing time`);
      // Msg&data rates disclaimer (English wording for en, locale-equivalent otherwise)
      const msgDataMarker = {
        en: "Msg&data rates may apply",
        fr: "Frais de messagerie applicables",
        es: "Pueden aplicar tarifas",
        ar: "قد تطبق رسوم"
      }[lang];
      assert.ok(text.includes(msgDataMarker), `${lang}: missing msg&data disclaimer`);
      assert.ok(!text.includes("Google") && !text.includes("Outlook"));
    });
  }
});

describe("SMS reminder templates (BOO-SMS-COMPLIANCE-1A)", () => {
  const data = {
    businessName: "Diamond Car Wash Rideau",
    serviceName: "Full Wash",
    time: "3:00 PM"
  };
  for (const lang of ["en", "fr", "es", "ar"]) {
    it(`${lang} 24h reminder includes business + service + STOP`, () => {
      const fn = getSmsTemplate(lang, "reminder");
      const text = fn(data);
      assert.ok(text.includes("STOP"), `${lang} reminder missing STOP`);
      assert.ok(text.includes("Diamond Car Wash Rideau"));
      assert.ok(text.includes("Full Wash"));
    });
    it(`${lang} 1h reminder includes STOP`, () => {
      const fn = getSmsTemplate(lang, "reminderOneHour");
      const text = fn(data);
      assert.ok(text.includes("STOP"));
      assert.ok(text.includes("Diamond Car Wash Rideau"));
    });
    it(`${lang} 30min reminder includes STOP`, () => {
      const fn = getSmsTemplate(lang, "reminderThirtyMin");
      const text = fn(data);
      assert.ok(text.includes("STOP"));
      assert.ok(text.includes("Diamond Car Wash Rideau"));
    });
  }
});

describe("SMS cancellation templates (BOO-SMS-COMPLIANCE-1A)", () => {
  const data = {
    businessName: "Diamond Car Wash Rideau",
    serviceName: "Full Wash",
    date: "May 15",
    time: "3:00 PM"
  };
  for (const lang of ["en", "fr", "es", "ar"]) {
    it(`${lang} cancellation includes business + service + STOP`, () => {
      const fn = getSmsTemplate(lang, "cancellation");
      const text = fn(data);
      assert.ok(text.includes("STOP"), `${lang} cancellation missing STOP`);
      assert.ok(text.includes("Diamond Car Wash Rideau"));
      assert.ok(text.includes("Full Wash"));
    });
  }
});

describe("SMS reschedule templates (BOO-SMS-COMPLIANCE-1A)", () => {
  const data = {
    businessName: "Diamond Car Wash Rideau",
    serviceName: "Full Wash",
    date: "Fri May 15",
    time: "3:00 PM"
  };
  for (const lang of ["en", "fr", "es", "ar"]) {
    it(`${lang} reschedule includes business + service + CANCEL BOOKING + STOP`, () => {
      const fn = getSmsTemplate(lang, "reschedule");
      const text = fn(data);
      assert.ok(text.includes("CANCEL BOOKING"), `${lang} reschedule missing CANCEL BOOKING`);
      assert.ok(text.includes("STOP"), `${lang} reschedule missing STOP`);
      assert.ok(text.includes("Diamond Car Wash Rideau"));
      assert.ok(text.includes("Full Wash"));
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

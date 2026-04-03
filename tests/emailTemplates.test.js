/**
 * BOO-38A: multilingual email subjects and booking language resolution.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getEmailSubject,
  getBookingLanguageRaw,
  getConfirmationSlotDisplay,
  buildIcsEventDescription
} from "../services/templates/emailTemplates.js";

describe("emailTemplates (BOO-38A)", () => {
  it("getEmailSubject uses service + business per locale", () => {
    assert.match(getEmailSubject("fr", "Coupe", "Salon"), /Coupe.*Salon/);
    assert.ok(getEmailSubject("fr", "Coupe", "Salon").includes("Rendez-vous confirmé"));
    assert.ok(getEmailSubject("es", "Corte", "Barber").includes("Reserva confirmada"));
    assert.ok(getEmailSubject("ar", "قص", "صالون").includes("تم تأكيد الحجز"));
  });

  it("getBookingLanguageRaw reads language from Mongoose-like toObject()", () => {
    const doc = {
      toObject() {
        return { language: "fr", id: "bk_x" };
      }
    };
    assert.strictEqual(getBookingLanguageRaw(doc), "fr");
  });

  it("getBookingLanguageRaw reads plain object", () => {
    assert.strictEqual(getBookingLanguageRaw({ language: "es" }), "es");
  });

  it("getConfirmationSlotDisplay is not English-only for fr/es/ar", () => {
    assert.ok(getConfirmationSlotDisplay("fr", "lun.", "10:00").includes(" à "));
    assert.ok(getConfirmationSlotDisplay("es", "lun.", "10:00").includes(" a las "));
    assert.ok(getConfirmationSlotDisplay("ar", "١", "10:00").includes("الساعة"));
  });

  it("buildIcsEventDescription localizes lines", () => {
    const fr = buildIcsEventDescription("fr", {
      serviceName: "S",
      businessName: "B",
      dateStr: "d",
      timeStr: "t",
      bookingId: "bk_1"
    });
    assert.ok(fr.includes("chez"));
    assert.ok(fr.includes("Réf."));
  });
});

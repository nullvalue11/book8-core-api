/**
 * BOO-CANCEL-1A — businessHardDelete + auditLog unit tests
 *
 * These tests purposefully avoid depending on a live MongoDB or Twilio
 * account: they exercise the pure pieces (Twilio HTTP release path with a
 * fake client, audit-log event constants, and the protected-business
 * guards inside hardDeleteBusiness).
 */
import { describe, it } from "node:test";
import assert from "node:assert";

import { releaseTwilioNumberHttp, hardDeleteBusiness } from "../services/businessHardDelete.js";
import { AUDIT_EVENTS } from "../src/utils/auditLog.js";

describe("auditLog AUDIT_EVENTS (BOO-CANCEL-1A)", () => {
  it("exposes all required event types", () => {
    assert.strictEqual(AUDIT_EVENTS.SUBSCRIPTION_CANCELLED, "subscription_cancelled");
    assert.strictEqual(AUDIT_EVENTS.SUBSCRIPTION_RESTORED, "subscription_restored");
    assert.strictEqual(AUDIT_EVENTS.BUSINESS_SOFT_DELETED, "business_soft_deleted");
    assert.strictEqual(AUDIT_EVENTS.BUSINESS_HARD_DELETED, "business_hard_deleted");
    assert.strictEqual(AUDIT_EVENTS.REFUND_ISSUED, "refund_issued");
    assert.strictEqual(AUDIT_EVENTS.CANCELLATION_FAILED, "cancellation_failed");
  });

  it("AUDIT_EVENTS object is frozen / immutable", () => {
    assert.throws(() => {
      // eslint-disable-next-line no-undef
      AUDIT_EVENTS.NEW = "x";
    });
  });
});

describe("releaseTwilioNumberHttp (BOO-CANCEL-1A)", () => {
  function makeFakeTwilio({ removeImpl } = {}) {
    return {
      incomingPhoneNumbers: (sid) => ({
        async remove() {
          return removeImpl ? removeImpl(sid) : { sid, status: "released" };
        }
      })
    };
  }

  it("returns no_sid_or_number when called with neither sid nor phoneNumber", async () => {
    const r = await releaseTwilioNumberHttp({});
    assert.strictEqual(r.released, false);
    assert.strictEqual(r.error, "no_sid_or_number");
  });

  it("refuses to release the protected Diamond Rideau number", async () => {
    const r = await releaseTwilioNumberHttp({
      twilioSid: "PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      phoneNumber: "+14318163850",
      twilioClient: makeFakeTwilio()
    });
    assert.strictEqual(r.released, false);
    assert.strictEqual(r.error, "protected_phone_number");
  });

  it("calls twilioClient.incomingPhoneNumbers(sid).remove() and returns released:true", async () => {
    let capturedSid = null;
    const fake = {
      incomingPhoneNumbers: (sid) => {
        capturedSid = sid;
        return {
          async remove() {
            return { sid, status: "released" };
          }
        };
      }
    };
    const r = await releaseTwilioNumberHttp({
      twilioSid: "PN123",
      phoneNumber: "+15555550100",
      twilioClient: fake
    });
    assert.strictEqual(r.released, true);
    assert.strictEqual(r.sid, "PN123");
    assert.strictEqual(capturedSid, "PN123");
  });

  it("treats Twilio 404 as already-released (idempotent)", async () => {
    const err404 = Object.assign(new Error("not found"), { status: 404 });
    const fake = makeFakeTwilio({
      removeImpl: () => {
        throw err404;
      }
    });
    const r = await releaseTwilioNumberHttp({
      twilioSid: "PN404",
      twilioClient: fake
    });
    assert.strictEqual(r.released, true);
    assert.strictEqual(r.alreadyReleased, true);
  });

  it("surfaces unknown Twilio errors as released:false with message", async () => {
    const fake = makeFakeTwilio({
      removeImpl: () => {
        throw Object.assign(new Error("rate limited"), { status: 429 });
      }
    });
    const r = await releaseTwilioNumberHttp({
      twilioSid: "PN429",
      twilioClient: fake
    });
    assert.strictEqual(r.released, false);
    assert.strictEqual(r.error, "rate limited");
  });

  it("looks up sid from phoneNumber when not provided", async () => {
    const fake = {
      incomingPhoneNumbers: Object.assign(
        (sid) => ({
          async remove() {
            return { sid, status: "released" };
          }
        }),
        {
          list: async ({ phoneNumber }) => [{ sid: "PN_LOOKED_UP", phoneNumber }]
        }
      )
    };
    const r = await releaseTwilioNumberHttp({
      phoneNumber: "+15555550111",
      twilioClient: fake
    });
    assert.strictEqual(r.released, true);
    assert.strictEqual(r.sid, "PN_LOOKED_UP");
  });
});

describe("hardDeleteBusiness input validation (BOO-CANCEL-1A)", () => {
  it("rejects missing businessId synchronously without DB access", async () => {
    const r = await hardDeleteBusiness({});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, "businessId_required");
  });

  it("refuses to operate on Diamond Rideau (biz_mnmqsh4xnfygae) by default", async () => {
    const r = await hardDeleteBusiness({ businessId: "biz_mnmqsh4xnfygae" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, "protected_business");
  });
});

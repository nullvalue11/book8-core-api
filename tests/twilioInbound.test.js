/**
 * Basic tests for POST /api/twilio/inbound-sms (Twilio webhook).
 * Without a valid Twilio signature, the endpoint returns 403.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";

describe("POST /api/twilio/inbound-sms", () => {
  it("rejects when X-Twilio-Signature is missing (403 or 503)", async () => {
    const res = await request(app)
      .post("/api/twilio/inbound-sms")
      .type("form")
      .send({ From: "+16132659661", To: "+16477882883", Body: "CANCEL" });
    assert.ok([403, 503].includes(res.status), "expected 403 or 503, got " + res.status);
  });

  it("rejects when X-Twilio-Signature is invalid (403 or 503)", async () => {
    const res = await request(app)
      .post("/api/twilio/inbound-sms")
      .set("X-Twilio-Signature", "invalid-signature")
      .type("form")
      .send({ From: "+16132659661", To: "+16477882883", Body: "CANCEL" });
    assert.ok([403, 503].includes(res.status), "expected 403 or 503, got " + res.status);
  });
});

/**
 * BOO-PHASE4B-2A — GET /api/businesses/:id/phone
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { getEffectiveBusinessPhone } from "../src/utils/businessPhone.js";

const TEST_BIZ = "test-business-phone-endpoint";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";
const DEMO_NUMBER = "+15550001234";

describe("business effective phone (BOO-PHASE4B-2A)", () => {
  before(async () => {
    process.env.BOOK8_DEMO_TWILIO_NUMBER = DEMO_NUMBER;
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_BIZ },
      {
        $set: {
          id: TEST_BIZ,
          name: "Phone Endpoint Test",
          timezone: "America/Toronto",
          plan: "growth"
        },
        $unset: { assignedTwilioNumber: "" }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    delete process.env.BOOK8_DEMO_TWILIO_NUMBER;
    await Business.deleteOne({ id: TEST_BIZ });
  });

  it("getEffectiveBusinessPhone returns demo line when no dedicated number", async () => {
    const biz = await Business.findOne({ id: TEST_BIZ }).lean();
    const phone = await getEffectiveBusinessPhone(biz);
    assert.strictEqual(phone.source, "demo_line");
    assert.strictEqual(phone.phoneNumber, DEMO_NUMBER);
    assert.strictEqual(phone.hasDedicatedNumber, false);
  });

  it("getEffectiveBusinessPhone returns dedicated number when assigned", async () => {
    await Business.updateOne({ id: TEST_BIZ }, { $set: { assignedTwilioNumber: "+15559998888" } });
    const biz = await Business.findOne({ id: TEST_BIZ }).lean();
    const phone = await getEffectiveBusinessPhone(biz);
    assert.strictEqual(phone.source, "dedicated");
    assert.strictEqual(phone.phoneNumber, "+15559998888");
    assert.strictEqual(phone.hasDedicatedNumber, true);
    await Business.updateOne({ id: TEST_BIZ }, { $unset: { assignedTwilioNumber: "" } });
  });

  it("GET /api/businesses/:id/phone returns effective number payload", async () => {
    const res = await request(app)
      .get(`/api/businesses/${TEST_BIZ}/phone`)
      .set("x-book8-internal-secret", INTERNAL_SECRET);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.businessId, TEST_BIZ);
    assert.strictEqual(res.body.phoneNumber, DEMO_NUMBER);
    assert.strictEqual(res.body.source, "demo_line");
    assert.strictEqual(res.body.hasDedicatedNumber, false);
    assert.ok(res.body.twilioNumberStatus);
  });
});

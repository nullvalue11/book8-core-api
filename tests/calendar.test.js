/**
 * Route-level tests for POST /api/calendar/availability
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../index.js";
import { Business } from "../models/Business.js";

const TEST_BUSINESS_ID = "test-calendar-availability-gym";

describe("POST /api/calendar/availability", () => {
  before(async () => {
    await Business.findOneAndUpdate(
      { id: TEST_BUSINESS_ID },
      {
        $set: {
          id: TEST_BUSINESS_ID,
          name: "Test Gym",
          timezone: "America/Toronto",
          services: [{ id: "personal-training-60", name: "PT", duration: 60, price: 80 }]
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Business.deleteOne({ id: TEST_BUSINESS_ID });
    await mongoose.connection.close();
  });

  it("returns 400 when businessId is missing", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
        timezone: "America/Toronto",
        durationMinutes: 60
      });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
    assert.ok(res.body.error?.includes("businessId") || res.body.error?.includes("required"));
  });

  it("returns 400 when from/to are missing", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: TEST_BUSINESS_ID,
        timezone: "America/Toronto"
      });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
  });

  it("returns 404 when business not found", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: "non-existent-business-xyz",
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
        timezone: "America/Toronto",
        durationMinutes: 60
      });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.error, "Business not found");
  });

  it("returns 200 and slots for valid request (happy path)", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "personal-training-60",
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
        timezone: "America/Toronto",
        durationMinutes: 60
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.businessId, TEST_BUSINESS_ID);
    assert.strictEqual(res.body.timezone, "America/Toronto");
    assert.ok(Array.isArray(res.body.slots));
    if (res.body.slots.length > 0) {
      assert.ok(res.body.slots[0].start);
      assert.ok(res.body.slots[0].end);
      assert.ok(res.body.slots[0].display);
    }
  });
});

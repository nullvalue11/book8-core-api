/**
 * Route-level tests for POST /api/calendar/availability
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";

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
          plan: "starter"
        }
      },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: TEST_BUSINESS_ID, serviceId: "personal-training-60" },
      {
        $set: {
          businessId: TEST_BUSINESS_ID,
          serviceId: "personal-training-60",
          name: "Personal Training",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true, new: true }
    );
    await Schedule.findOneAndUpdate(
      { businessId: TEST_BUSINESS_ID },
      {
        $set: {
          businessId: TEST_BUSINESS_ID,
          timezone: "America/Toronto",
          weeklyHours: {
            monday: [{ start: "09:00", end: "17:00" }],
            tuesday: [{ start: "09:00", end: "17:00" }],
            wednesday: [{ start: "09:00", end: "17:00" }],
            thursday: [{ start: "09:00", end: "17:00" }],
            friday: [{ start: "09:00", end: "17:00" }],
            saturday: [],
            sunday: []
          }
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Service.deleteMany({ businessId: TEST_BUSINESS_ID });
    await Schedule.deleteOne({ businessId: TEST_BUSINESS_ID });
    await Business.deleteOne({ id: TEST_BUSINESS_ID });
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

  it("returns 400 when serviceId is missing", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: TEST_BUSINESS_ID,
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
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
        serviceId: "intro-session-60",
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
        timezone: "America/Toronto"
      });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.error, "Business not found");
  });

  it("returns 404 when service not found", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "nonexistent-service",
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
        timezone: "America/Toronto"
      });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.error, "Service not found");
  });

  it("returns 400 when service is inactive", async () => {
    await Service.findOneAndUpdate(
      { businessId: TEST_BUSINESS_ID, serviceId: "inactive-svc" },
      {
        $set: {
          businessId: TEST_BUSINESS_ID,
          serviceId: "inactive-svc",
          name: "Inactive",
          durationMinutes: 30,
          active: false
        }
      },
      { upsert: true, new: true }
    );
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "inactive-svc",
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
        timezone: "America/Toronto"
      });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.error, "Service is not active");
    await Service.deleteOne({ businessId: TEST_BUSINESS_ID, serviceId: "inactive-svc" });
  });

  it("returns 200 and slots for valid request (happy path)", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "personal-training-60",
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
        timezone: "America/Toronto"
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

  it("returns 200 and slots when gcal-busy is unreachable (graceful degradation)", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "personal-training-60",
        from: "2026-03-08T00:00:00-05:00",
        to: "2026-03-09T00:00:00-05:00",
        timezone: "America/Toronto"
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(Array.isArray(res.body.slots));
  });
});

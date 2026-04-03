/**
 * Tests for service/schedule endpoints and bootstrap idempotency.
 * Requires MongoDB running.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { ensureBookableDefaultsForBusiness } from "../services/bookableBootstrap.js";

const TEST_BUSINESS_ID = "test-services-schedule-gym";
const API_KEY = process.env.BOOK8_CORE_API_KEY || "test-api-key";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

function apiKeyHeader(req) {
  req.set("x-book8-api-key", API_KEY);
  return req;
}

function internalAuth(req) {
  req.set("x-book8-internal-secret", INTERNAL_SECRET);
  return req;
}

describe("Services and Schedule endpoints", () => {
  before(async () => {
    if (!process.env.BOOK8_CORE_API_KEY) process.env.BOOK8_CORE_API_KEY = API_KEY;
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_BUSINESS_ID },
      {
        $set: {
          id: TEST_BUSINESS_ID,
          name: "Test Services Gym",
          timezone: "America/Toronto",
          phoneNumber: "+16135550100",
          assignedTwilioNumber: "+15551234567"
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

  it("GET /api/businesses/:id/services returns 404 when business not found", async () => {
    const res = await request(app).get("/api/businesses/nonexistent-id/services");
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.ok, false);
  });

  it("GET /api/businesses/:id/services returns empty array when no services", async () => {
    const res = await request(app).get(`/api/businesses/${TEST_BUSINESS_ID}/services`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(Array.isArray(res.body.services));
  });

  it("POST /api/businesses/:id/services creates service", async () => {
    const res = await apiKeyHeader(
      request(app).post(`/api/businesses/${TEST_BUSINESS_ID}/services`).send({
        serviceId: "personal-training-60",
        name: "Personal Training",
        durationMinutes: 60,
        active: true,
        price: 75,
        currency: "usd"
      })
    );
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.service.serviceId, "personal-training-60");
    assert.strictEqual(res.body.service.name, "Personal Training");
    assert.strictEqual(res.body.service.durationMinutes, 60);
    assert.strictEqual(res.body.service.price, 75);
    assert.strictEqual(res.body.service.currency, "USD");
  });

  it("GET /api/businesses/:id/services returns price and currency", async () => {
    const res = await request(app).get(`/api/businesses/${TEST_BUSINESS_ID}/services`);
    assert.strictEqual(res.status, 200);
    const svc = res.body.services.find((s) => s.serviceId === "personal-training-60");
    assert.ok(svc);
    assert.strictEqual(svc.price, 75);
    assert.strictEqual(svc.currency, "USD");
  });

  it("GET /api/businesses/:id public payload includes businessProfile and not Book8 Twilio number", async () => {
    const res = await request(app).get(`/api/businesses/${TEST_BUSINESS_ID}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.business.assignedTwilioNumber, undefined);
    assert.ok(res.body.business.businessProfile);
    assert.strictEqual(res.body.business.businessProfile.phone, "+16135550100");
  });

  it("GET /api/businesses/:id/public returns public-safe booking payload", async () => {
    const res = await request(app).get(`/api/businesses/${TEST_BUSINESS_ID}/public`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.businessName, "Test Services Gym");
    assert.ok(Array.isArray(res.body.services));
    assert.ok(res.body.businessHours?.weeklyHours);
    assert.strictEqual(res.body.businessProfile?.phone, "+16135550100");
    assert.strictEqual(res.body.assignedTwilioNumber, undefined);
    assert.strictEqual(res.body.stripeCustomerId, undefined);
  });

  it("PATCH /api/businesses/:id/profile returns 401 without internal auth", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${TEST_BUSINESS_ID}/profile`)
      .send({ businessProfile: { website: "https://example.com" } });
    assert.strictEqual(res.status, 401);
  });

  it("PATCH /api/businesses/:id/profile updates nested businessProfile", async () => {
    const res = await internalAuth(
      request(app).patch(`/api/businesses/${TEST_BUSINESS_ID}/profile`).send({
        businessProfile: {
          phone: "+16135550100",
          email: "hello@example.com",
          website: "https://gym.example.com",
          address: { city: "Ottawa", country: "CA" },
          socialLinks: { instagram: "https://instagram.com/testgym" }
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.business.businessProfile.phone, "+16135550100");
    assert.strictEqual(res.body.business.businessProfile.address.city, "Ottawa");
  });

  it("PATCH /api/businesses/:id/profile rejects invalid phone", async () => {
    const res = await internalAuth(
      request(app).patch(`/api/businesses/${TEST_BUSINESS_ID}/profile`).send({
        businessProfile: { phone: "555-0100" }
      })
    );
    assert.strictEqual(res.status, 400);
    assert.ok(String(res.body.error).includes("E.164"));
  });

  it("PATCH /api/businesses/:id/services/:serviceId returns 401 without internal auth", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${TEST_BUSINESS_ID}/services/personal-training-60`)
      .send({ price: 1 });
    assert.strictEqual(res.status, 401);
  });

  it("PATCH /api/businesses/:id/services/:serviceId updates with internal auth", async () => {
    const res = await internalAuth(
      request(app)
        .patch(`/api/businesses/${TEST_BUSINESS_ID}/services/personal-training-60`)
        .send({
          name: "Personal Training (updated)",
          durationMinutes: 90,
          price: 99,
          currency: "cad",
          active: true
        })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.service.name, "Personal Training (updated)");
    assert.strictEqual(res.body.service.durationMinutes, 90);
    assert.strictEqual(res.body.service.price, 99);
    assert.strictEqual(res.body.service.currency, "CAD");
    assert.strictEqual(res.body.service.active, true);
  });

  it("GET /api/businesses/:id/schedule returns 404 when business not found", async () => {
    const res = await request(app).get("/api/businesses/nonexistent-id/schedule");
    assert.strictEqual(res.status, 404);
  });

  it("GET /api/businesses/:id/schedule returns schedule or fallback", async () => {
    const res = await request(app).get(`/api/businesses/${TEST_BUSINESS_ID}/schedule`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.schedule);
    assert.ok(res.body.schedule.weeklyHours || res.body.schedule.timezone);
  });

  it("PUT /api/businesses/:id/schedule updates schedule", async () => {
    const weeklyHours = {
      monday: [{ start: "09:00", end: "17:00" }],
      tuesday: [{ start: "09:00", end: "17:00" }],
      wednesday: [{ start: "09:00", end: "17:00" }],
      thursday: [{ start: "09:00", end: "17:00" }],
      friday: [{ start: "09:00", end: "17:00" }],
      saturday: [],
      sunday: []
    };
    const res = await apiKeyHeader(
      request(app).put(`/api/businesses/${TEST_BUSINESS_ID}/schedule`).send({
        timezone: "America/Toronto",
        weeklyHours
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.deepStrictEqual(res.body.schedule.weeklyHours, weeklyHours);
  });

  it("ensureBookableDefaultsForBusiness is idempotent (no duplicate services/schedule)", async () => {
    const idempotentBusinessId = "test-bootstrap-idempotent-" + Date.now();
    await Business.create({
      id: idempotentBusinessId,
      name: "Idempotent Test",
      timezone: "America/Toronto"
    });
    const first = await ensureBookableDefaultsForBusiness(idempotentBusinessId);
    assert.strictEqual(first.defaultsEnsured, true);
    const second = await ensureBookableDefaultsForBusiness(idempotentBusinessId);
    assert.strictEqual(second.defaultsEnsured, false);
    const count = await Service.countDocuments({ businessId: idempotentBusinessId });
    assert.ok(count >= 1, "category-aware bootstrap creates one or more default services");
    const schedule = await Schedule.findOne({ businessId: idempotentBusinessId });
    assert.ok(schedule);
    await Service.deleteMany({ businessId: idempotentBusinessId });
    await Schedule.deleteOne({ businessId: idempotentBusinessId });
    await Business.deleteOne({ id: idempotentBusinessId });
  });
});

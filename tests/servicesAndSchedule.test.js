/**
 * Tests for service/schedule endpoints and bootstrap idempotency.
 * Requires MongoDB running.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { ensureBookableDefaultsForBusiness } from "../services/bookableBootstrap.js";

const TEST_BUSINESS_ID = "test-services-schedule-gym";
const API_KEY = process.env.BOOK8_CORE_API_KEY || "test-api-key";

function apiKeyHeader(req) {
  req.set("x-book8-api-key", API_KEY);
  return req;
}

describe("Services and Schedule endpoints", () => {
  before(async () => {
    if (!process.env.BOOK8_CORE_API_KEY) process.env.BOOK8_CORE_API_KEY = API_KEY;
    await Business.findOneAndUpdate(
      { id: TEST_BUSINESS_ID },
      { $set: { id: TEST_BUSINESS_ID, name: "Test Services Gym", timezone: "America/Toronto" } },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Service.deleteMany({ businessId: TEST_BUSINESS_ID });
    await Schedule.deleteOne({ businessId: TEST_BUSINESS_ID });
    await Business.deleteOne({ id: TEST_BUSINESS_ID });
    await mongoose.connection.close();
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
        active: true
      })
    );
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.service.serviceId, "personal-training-60");
    assert.strictEqual(res.body.service.name, "Personal Training");
    assert.strictEqual(res.body.service.durationMinutes, 60);
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
    assert.strictEqual(count, 1);
    const schedule = await Schedule.findOne({ businessId: idempotentBusinessId });
    assert.ok(schedule);
    await Service.deleteMany({ businessId: idempotentBusinessId });
    await Schedule.deleteOne({ businessId: idempotentBusinessId });
    await Business.deleteOne({ id: idempotentBusinessId });
  });
});

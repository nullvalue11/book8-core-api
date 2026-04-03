/**
 * Route-level tests for POST /api/bookings
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";

const TEST_BUSINESS_ID = "test-bookings-gym";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";
const SLOT = {
  start: "2026-03-08T14:00:00-05:00",
  end: "2026-03-08T15:00:00-05:00",
  timezone: "America/Toronto"
};

describe("Bookings API", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_BUSINESS_ID },
      {
        $set: {
          id: TEST_BUSINESS_ID,
          name: "Test Bookings Gym",
          timezone: "America/Toronto",
          plan: "growth"
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
          name: "PT",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Booking.deleteMany({ businessId: TEST_BUSINESS_ID });
    await Service.deleteMany({ businessId: TEST_BUSINESS_ID });
    await Business.deleteOne({ id: TEST_BUSINESS_ID });
  });

  it("returns 400 when businessId is missing", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        customer: { name: "Jane", phone: "+16475551234", email: "j@example.com" },
        slot: SLOT,
        source: "voice-agent"
      });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
  });

  it("returns 400 when customer is missing", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: TEST_BUSINESS_ID,
        slot: SLOT,
        source: "voice-agent"
      });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
  });

  it("returns 400 when slot is missing", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: TEST_BUSINESS_ID,
        customer: { name: "Jane", phone: "+16475551234" },
        source: "voice-agent"
      });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
  });

  it("returns 404 when business not found", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: "non-existent-business-xyz",
        serviceId: "personal-training-60",
        customer: { name: "Jane", phone: "+16475551234", email: "j@example.com" },
        slot: SLOT,
        notes: "First session",
        source: "voice-agent"
      });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.error, "Business not found");
  });

  it("returns 404 when service not found", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "nonexistent-service",
        customer: { name: "Jane", phone: "+16475551234", email: "j@example.com" },
        slot: SLOT,
        source: "voice-agent"
      });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.error, "Service not found");
  });

  it("returns 201 and booking + summary for valid request (happy path)", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "personal-training-60",
        customer: { name: "John Doe", phone: "+16475551234", email: "john@example.com" },
        slot: SLOT,
        notes: "First-time intro session",
        source: "voice-agent"
      });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.booking);
    assert.strictEqual(res.body.booking.businessId, TEST_BUSINESS_ID);
    assert.strictEqual(res.body.booking.customer.name, "John Doe");
    assert.strictEqual(res.body.booking.status, "confirmed");
    assert.ok(res.body.booking.id?.startsWith("bk_"));
    assert.ok(res.body.summary?.includes("John Doe"));
  });

  it("returns 409 when slot is no longer available (conflict)", async () => {
    const slot2 = {
      start: "2026-03-08T16:00:00-05:00",
      end: "2026-03-08T17:00:00-05:00",
      timezone: "America/Toronto"
    };
    const first = await request(app)
      .post("/api/bookings")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "personal-training-60",
        customer: { name: "First Customer", phone: "+16475550001", email: "first@example.com" },
        slot: slot2,
        source: "voice-agent"
      });
    assert.strictEqual(first.status, 201);

    const second = await request(app)
      .post("/api/bookings")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "personal-training-60",
        customer: { name: "Second Customer", phone: "+16475550002", email: "second@example.com" },
        slot: slot2,
        source: "voice-agent"
      });
    assert.strictEqual(second.status, 409);
    assert.strictEqual(second.body.ok, false);
    assert.ok(second.body.error?.toLowerCase().includes("no longer available") || second.body.error?.toLowerCase().includes("slot"));
  });

  it("GET /api/bookings returns 401 without internal auth (QA-004)", async () => {
    const res = await request(app).get(`/api/bookings?businessId=${TEST_BUSINESS_ID}`);
    assert.strictEqual(res.status, 401);
  });

  it("GET /api/bookings returns 200 with internal auth", async () => {
    const res = await request(app)
      .get(`/api/bookings?businessId=${TEST_BUSINESS_ID}`)
      .set("x-book8-internal-secret", INTERNAL_SECRET);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(Array.isArray(res.body.bookings));
  });

  it("PATCH cancel twice returns 404 on second call (QA-001)", async () => {
    const slot = {
      start: "2027-06-15T15:00:00-04:00",
      end: "2027-06-15T16:00:00-04:00",
      timezone: "America/Toronto"
    };
    const create = await request(app)
      .post("/api/bookings")
      .send({
        businessId: TEST_BUSINESS_ID,
        serviceId: "personal-training-60",
        customer: { name: "Cancel Twice", phone: "+16475559998", email: "cancel2@example.com" },
        slot,
        source: "voice-agent"
      });
    assert.strictEqual(create.status, 201, create.body?.error || "");
    const bookingId = create.body.booking.id;
    const first = await request(app)
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set("x-book8-internal-secret", INTERNAL_SECRET);
    assert.strictEqual(first.status, 200);
    const second = await request(app)
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set("x-book8-internal-secret", INTERNAL_SECRET);
    assert.strictEqual(second.status, 404);
    assert.strictEqual(second.body.ok, false);
    assert.ok(
      String(second.body.error || "")
        .toLowerCase()
        .includes("already cancelled") || String(second.body.error || "").includes("not found")
    );
  });
});

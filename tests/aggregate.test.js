/**
 * BOO-67A — Multi-location aggregate routes (Enterprise + owner email).
 * Requires MongoDB (NODE_ENV=test).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Booking } from "../models/Booking.js";
import { Call } from "../models/Call.js";
import { Service } from "../models/Service.js";

const API_KEY = process.env.BOOK8_CORE_API_KEY || "test-api-key";
const OWNER = "aggregate-e2e-owner@book8.test";
const BIZ_A = "test-agg-biz-a";
const BIZ_B = "test-agg-biz-b";
const BIZ_G = "test-agg-biz-growth";

function api(req) {
  return req.set("x-book8-api-key", API_KEY);
}

function owner(req) {
  return req.set("x-book8-user-email", OWNER);
}

describe("Aggregate multi-location API (BOO-67A)", () => {
  before(async () => {
    if (!process.env.BOOK8_CORE_API_KEY) process.env.BOOK8_CORE_API_KEY = API_KEY;

    await Business.deleteMany({ id: { $in: [BIZ_A, BIZ_B, BIZ_G] } });
    await Booking.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
    await Call.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
    await Service.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });

    await Business.create({
      id: BIZ_A,
      businessId: BIZ_A,
      name: "Agg Location A",
      email: OWNER,
      plan: "enterprise",
      phoneNumber: "+16135550101",
      assignedTwilioNumber: "+15551110001"
    });
    await Business.create({
      id: BIZ_B,
      businessId: BIZ_B,
      name: "Agg Location B",
      email: OWNER,
      plan: "enterprise",
      phoneNumber: "+16135550102",
      assignedTwilioNumber: "+15551110002"
    });

    await Service.create({
      businessId: BIZ_A,
      serviceId: "svc-cut",
      name: "Haircut",
      durationMinutes: 30,
      price: 50,
      currency: "USD"
    });
    await Service.create({
      businessId: BIZ_B,
      serviceId: "svc-cut",
      name: "Haircut",
      durationMinutes: 30,
      price: 40,
      currency: "USD"
    });

    const now = new Date();
    // Stats ranges end at `now`; slot must be in the past to be counted for today/week/month.
    const slotToday = {
      start: new Date(now.getTime() - 45 * 60 * 1000).toISOString(),
      end: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      timezone: "UTC"
    };

    await Booking.create({
      id: "bk_agg_a_1",
      businessId: BIZ_A,
      serviceId: "svc-cut",
      customer: { name: "Pat", phone: "+10000000001", email: "p@example.com" },
      slot: slotToday,
      status: "confirmed",
      language: "en"
    });
    await Booking.create({
      id: "bk_agg_b_1",
      businessId: BIZ_B,
      serviceId: "svc-cut",
      customer: { name: "Sam", phone: "+10000000002", email: "s@example.com" },
      slot: slotToday,
      status: "confirmed",
      language: "fr"
    });

    await Call.create({
      callSid: "CA_AGG_TEST_001",
      businessId: BIZ_A,
      from: "+10000000001",
      to: "+15551110001",
      status: "completed",
      durationSeconds: 120
    });
  });

  after(async () => {
    await Booking.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
    await Call.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
    await Service.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
    await Business.deleteMany({ id: { $in: [BIZ_A, BIZ_B, BIZ_G] } });
  });

  it("returns 400 without owner email", async () => {
    const res = await api(request(app).get("/api/businesses/aggregate/stats"));
    assert.strictEqual(res.status, 400);
  });

  it("GET /aggregate/stats returns combined totals for enterprise owner", async () => {
    const res = await owner(api(request(app).get("/api/businesses/aggregate/stats")));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totalBusinesses, 2);
    assert.ok(res.body.totalBookingsToday >= 2);
    assert.ok(res.body.totalCallsToday >= 1);
    assert.strictEqual(typeof res.body.totalRevenue, "number");
    assert.ok(Array.isArray(res.body.businesses));
    assert.strictEqual(res.body.businesses.length, 2);
  });

  it("GET /aggregate/bookings supports pagination", async () => {
    const res = await owner(
      api(
        request(app)
          .get("/api/businesses/aggregate/bookings")
          .query({ limit: 1, offset: 0 })
      )
    );
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.total >= 2);
    assert.strictEqual(res.body.bookings.length, 1);
    assert.ok(res.body.bookings[0].businessName);
    assert.ok(res.body.bookings[0].clientName);
  });

  it("GET /aggregate/analytics returns shape", async () => {
    const res = await owner(
      api(request(app).get("/api/businesses/aggregate/analytics").query({ period: "week" }))
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.period, "week");
    assert.ok(Array.isArray(res.body.bookingsTrend));
    assert.ok(Array.isArray(res.body.topLanguages));
    assert.ok(Array.isArray(res.body.topServices));
    assert.ok(Array.isArray(res.body.byLocation));
  });

  it("returns 403 for non-Enterprise when any owned business is below enterprise", async () => {
    await Business.create({
      id: BIZ_G,
      businessId: BIZ_G,
      name: "Growth Only",
      email: OWNER,
      plan: "growth",
      phoneNumber: "+16135550103",
      assignedTwilioNumber: "+15551110003"
    });
    try {
      const res = await owner(api(request(app).get("/api/businesses/aggregate/stats")));
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, "Multi-location features require the Enterprise plan");
      assert.strictEqual(res.body.upgradeUrl, "https://www.book8.io/pricing");
    } finally {
      await Business.deleteOne({ id: BIZ_G });
    }
  });

  it("POST /aggregate/settings updates allowed businesses", async () => {
    const res = await owner(
      api(request(app).post("/api/businesses/aggregate/settings").send({
        businessIds: [BIZ_A],
        settings: {
          noShowProtection: { enabled: false, feeAmount: 0 }
        }
      }))
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const b = await Business.findOne({ id: BIZ_A }).lean();
    assert.strictEqual(b.noShowProtection.enabled, false);
  });
});

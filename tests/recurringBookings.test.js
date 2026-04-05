/**
 * BOO-60A: recurring bookings — plan gate, POST recurring, GET/DELETE series
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";

const GROWTH_ID = "test-recurring-growth-biz";
const STARTER_ID = "test-recurring-starter-biz";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

const SLOT = {
  start: "2026-06-02T14:00:00.000Z",
  end: "2026-06-02T15:00:00.000Z",
  timezone: "America/Toronto"
};

const RECURRING = {
  enabled: true,
  frequency: "weekly",
  totalOccurrences: 4,
  autoRenew: true
};

describe("Recurring bookings (BOO-60A)", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;

    for (const { id, plan } of [
      { id: GROWTH_ID, plan: "growth" },
      { id: STARTER_ID, plan: "starter" }
    ]) {
      await Business.findOneAndUpdate(
        { id },
        {
          $set: {
            id,
            name: `Recurring test ${plan}`,
            timezone: "America/Toronto",
            plan
          }
        },
        { upsert: true, new: true }
      );
      await Service.findOneAndUpdate(
        { businessId: id, serviceId: "svc-rec-60" },
        {
          $set: {
            businessId: id,
            serviceId: "svc-rec-60",
            name: "Recurring Svc",
            durationMinutes: 60,
            active: true
          }
        },
        { upsert: true, new: true }
      );
    }
  });

  after(async () => {
    await Booking.deleteMany({ businessId: { $in: [GROWTH_ID, STARTER_ID] } });
    await Service.deleteMany({ businessId: { $in: [GROWTH_ID, STARTER_ID] } });
    await Business.deleteMany({ id: { $in: [GROWTH_ID, STARTER_ID] } });
  });

  it("returns 403 when Starter plan sends recurring", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: STARTER_ID,
        serviceId: "svc-rec-60",
        customer: { name: "Pat", phone: "+16475559999", email: "pat@example.com" },
        slot: SLOT,
        source: "web",
        recurring: RECURRING
      });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.upgrade, true);
  });

  it("creates first occurrence with seriesId on Growth", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: GROWTH_ID,
        serviceId: "svc-rec-60",
        customer: { name: "Alex", phone: "+16475558888", email: "alex@example.com" },
        slot: SLOT,
        source: "web",
        recurring: RECURRING
      });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.booking?.seriesId);
    assert.strictEqual(res.body.booking?.recurring?.occurrenceNumber, 1);
    assert.strictEqual(res.body.booking?.recurring?.totalOccurrences, 4);
  });

  it("GET /api/bookings/series/:seriesId lists series (internal auth)", async () => {
    const create = await request(app)
      .post("/api/bookings")
      .send({
        businessId: GROWTH_ID,
        serviceId: "svc-rec-60",
        customer: { name: "Sam", phone: "+16475557777", email: "sam@example.com" },
        slot: {
          start: "2026-06-09T14:00:00.000Z",
          end: "2026-06-09T15:00:00.000Z",
          timezone: "America/Toronto"
        },
        source: "web",
        recurring: RECURRING
      });
    assert.strictEqual(create.status, 201);
    const sid = create.body.booking.seriesId;

    const list = await request(app)
      .get(`/api/bookings/series/${encodeURIComponent(sid)}`)
      .set("x-internal-secret", INTERNAL_SECRET);

    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.ok, true);
    assert.strictEqual(list.body.seriesId, sid);
    assert.ok(Array.isArray(list.body.bookings));
    assert.strictEqual(list.body.bookings.length, 1);
  });
});

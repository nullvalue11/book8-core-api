/**
 * BOO-59A waitlist API
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { Waitlist } from "../models/Waitlist.js";
import { processWaitlistForFreedBooking } from "../services/waitlistService.js";
import { signWaitlistCancelToken } from "../services/waitlistToken.js";

const TEST_BIZ = "test-waitlist-biz";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

describe("Waitlist API (BOO-59A)", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    if (!process.env.WAITLIST_JWT_SECRET) process.env.WAITLIST_JWT_SECRET = INTERNAL_SECRET;

    await Business.findOneAndUpdate(
      { id: TEST_BIZ },
      {
        $set: {
          id: TEST_BIZ,
          name: "Waitlist Gym",
          timezone: "America/Toronto",
          plan: "growth",
          assignedTwilioNumber: "+15550009999"
        }
      },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: TEST_BIZ, serviceId: "svc-wl" },
      {
        $set: {
          businessId: TEST_BIZ,
          serviceId: "svc-wl",
          name: "Training",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Waitlist.deleteMany({ businessId: TEST_BIZ });
    await Booking.deleteMany({ businessId: TEST_BIZ });
    await Service.deleteMany({ businessId: TEST_BIZ });
    await Business.deleteOne({ id: TEST_BIZ });
  });

  it("POST join returns 403 on Starter plan", async () => {
    const starterId = "test-waitlist-starter";
    await Business.findOneAndUpdate(
      { id: starterId },
      {
        $set: {
          id: starterId,
          name: "Starter Co",
          timezone: "America/Toronto",
          plan: "starter"
        }
      },
      { upsert: true, new: true }
    );
    const res = await request(app)
      .post(`/api/businesses/${starterId}/waitlist`)
      .send({
        customer: { name: "A" },
        preferredDates: ["2026-06-01"],
        serviceId: "svc-wl",
        serviceName: "Training"
      });
    assert.strictEqual(res.status, 403);
    await Business.deleteOne({ id: starterId });
  });

  it("POST join creates entry with position and cancelToken", async () => {
    const res = await request(app)
      .post(`/api/businesses/${TEST_BIZ}/waitlist`)
      .send({
        customer: { name: "Jane", phone: "+15551112222", email: "j@example.com" },
        preferredDates: ["2026-08-15"],
        serviceId: "svc-wl",
        serviceName: "Training",
        language: "en"
      });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.waitlistId?.startsWith("wl_"));
    assert.strictEqual(typeof res.body.position, "number");
    assert.ok(res.body.cancelToken);

    await Waitlist.deleteOne({ id: res.body.waitlistId });
  });

  it("GET list requires internal auth", async () => {
    const r401 = await request(app).get(`/api/businesses/${TEST_BIZ}/waitlist`);
    assert.strictEqual(r401.status, 401);

    const r200 = await request(app)
      .get(`/api/businesses/${TEST_BIZ}/waitlist`)
      .set("x-book8-internal-secret", INTERNAL_SECRET);
    assert.strictEqual(r200.status, 200);
    assert.strictEqual(r200.body.ok, true);
    assert.ok(Array.isArray(r200.body.entries));
  });

  it("notifies first waitlist entry when slot freed", async () => {
    const slotDate = "2026-09-20";
    const wl = await Waitlist.create({
      id: `wl_test_${Date.now()}`,
      businessId: TEST_BIZ,
      serviceId: "svc-wl",
      serviceName: "Training",
      customer: { name: "Bob", phone: "+15553334444", email: "b@example.com" },
      preferredDates: [slotDate],
      language: "en",
      status: "waiting",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    const booking = {
      businessId: TEST_BIZ,
      serviceId: "svc-wl",
      providerId: null,
      slot: {
        start: "2026-09-20T14:00:00.000Z",
        end: "2026-09-20T15:00:00.000Z",
        timezone: "America/Toronto"
      }
    };

    await processWaitlistForFreedBooking(booking);

    const updated = await Waitlist.findOne({ id: wl.id }).lean();
    assert.strictEqual(updated.status, "notified");
    assert.ok(updated.notifiedSlot?.start);
    assert.ok(updated.notificationExpiresAt);

    await Waitlist.deleteOne({ id: wl.id });
  });

  it("DELETE with cancel token removes entry", async () => {
    const doc = await Waitlist.create({
      id: `wl_del_${Date.now()}`,
      businessId: TEST_BIZ,
      serviceId: "svc-wl",
      serviceName: "Training",
      customer: { name: "Del", phone: "+15559998888" },
      preferredDates: ["2026-10-01"],
      language: "en",
      status: "waiting",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    const token = signWaitlistCancelToken(doc.id, TEST_BIZ);
    const res = await request(app)
      .delete(`/api/businesses/${TEST_BIZ}/waitlist/${doc.id}?token=${encodeURIComponent(token)}`);
    assert.strictEqual(res.status, 200);
    const gone = await Waitlist.findOne({ id: doc.id });
    assert.strictEqual(gone, null);
  });
});

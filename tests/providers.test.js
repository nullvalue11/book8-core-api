/**
 * BOO-44A multi-provider API
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { Provider } from "../models/Provider.js";
import { Booking } from "../models/Booking.js";

const GROWTH_ID = "test-providers-growth-biz";
const STARTER_ID = "test-providers-starter-biz";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

function internal(req) {
  return req.set("x-book8-internal-secret", INTERNAL_SECRET);
}

describe("Multi-provider (BOO-44A)", () => {
  let providerId;

  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;

    await Business.findOneAndUpdate(
      { id: GROWTH_ID },
      {
        $set: {
          id: GROWTH_ID,
          name: "Growth Salon",
          timezone: "America/Toronto",
          plan: "growth"
        }
      },
      { upsert: true }
    );
    await Service.findOneAndUpdate(
      { businessId: GROWTH_ID, serviceId: "cut" },
      {
        $set: {
          businessId: GROWTH_ID,
          serviceId: "cut",
          name: "Haircut",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true }
    );
    await Schedule.findOneAndUpdate(
      { businessId: GROWTH_ID },
      {
        $set: {
          businessId: GROWTH_ID,
          timezone: "America/Toronto",
          weeklyHours: {
            monday: [{ start: "09:00", end: "17:00" }],
            tuesday: [],
            wednesday: [],
            thursday: [],
            friday: [],
            saturday: [],
            sunday: []
          }
        }
      },
      { upsert: true }
    );

    await Business.findOneAndUpdate(
      { id: STARTER_ID },
      {
        $set: {
          id: STARTER_ID,
          name: "Starter Solo",
          timezone: "America/Toronto",
          plan: "starter"
        }
      },
      { upsert: true }
    );
  });

  after(async () => {
    await Booking.deleteMany({ businessId: GROWTH_ID });
    await Provider.deleteMany({ businessId: GROWTH_ID });
    await Service.deleteMany({ businessId: GROWTH_ID });
    await Schedule.deleteOne({ businessId: GROWTH_ID });
    await Business.deleteOne({ id: GROWTH_ID });
    await Business.deleteOne({ id: STARTER_ID });
  });

  it("POST provider blocked on Starter plan", async () => {
    const res = await internal(
      request(app).post(`/api/businesses/${STARTER_ID}/providers`).send({ name: "No Go" })
    );
    assert.strictEqual(res.status, 403);
  });

  it("POST and GET providers (growth)", async () => {
    const create = await internal(
      request(app)
        .post(`/api/businesses/${GROWTH_ID}/providers`)
        .send({
          name: "Marcus",
          title: "Barber",
          services: ["cut"],
          schedule: {
            weeklyHours: {
              monday: { open: "10:00", close: "16:00", isOpen: true },
              tuesday: { open: "09:00", close: "17:00", isOpen: true },
              wednesday: { isOpen: false },
              thursday: { isOpen: false },
              friday: { isOpen: false },
              saturday: { isOpen: false },
              sunday: { isOpen: false }
            }
          },
          sortOrder: 1
        })
    );
    assert.strictEqual(create.status, 201, create.body?.error || "");
    assert.ok(create.body.provider?.id);
    providerId = create.body.provider.id;

    const list = await request(app).get(`/api/businesses/${GROWTH_ID}/providers`);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.providers.length, 1);
    assert.strictEqual(list.body.providers[0].name, "Marcus");
    assert.strictEqual(list.body.providers[0].email, undefined);

    const one = await request(app).get(`/api/businesses/${GROWTH_ID}/providers/${providerId}`);
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.provider.name, "Marcus");
  });

  it("calendar availability with providerId returns slots", async () => {
    const res = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: GROWTH_ID,
        serviceId: "cut",
        from: "2027-03-01T00:00:00-05:00",
        to: "2027-03-07T23:59:59-05:00",
        timezone: "America/Toronto",
        providerId
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.providerId, providerId);
    assert.ok(Array.isArray(res.body.slots));
    assert.ok(res.body.slots.length >= 1, "expected at least one slot from provider hours");
  });

  it("POST booking with providerId stores provider", async () => {
    const av = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: GROWTH_ID,
        serviceId: "cut",
        from: "2027-03-01T00:00:00-05:00",
        to: "2027-03-02T23:59:59-05:00",
        timezone: "America/Toronto",
        providerId
      });
    assert.ok(av.body.slots?.length);
    const slot = av.body.slots[0];
    const book = await request(app)
      .post("/api/bookings")
      .send({
        businessId: GROWTH_ID,
        serviceId: "cut",
        customer: { name: "Pat", phone: "+16135550001", email: "p@example.com" },
        slot: { start: slot.start, end: slot.end, timezone: "America/Toronto" },
        source: "web",
        providerId,
        providerName: "Marcus"
      });
    assert.strictEqual(book.status, 201, book.body?.error || "");
    assert.strictEqual(book.body.booking.providerId, providerId);
    assert.strictEqual(book.body.booking.providerName, "Marcus");
    await Booking.deleteOne({ id: book.body.booking.id });
  });

  it("POST booking without providerId still works", async () => {
    const av = await request(app)
      .post("/api/calendar/availability")
      .send({
        businessId: GROWTH_ID,
        serviceId: "cut",
        from: "2027-03-08T00:00:00-05:00",
        to: "2027-03-09T23:59:59-05:00",
        timezone: "America/Toronto"
      });
    assert.ok(av.body.slots?.length);
    const slot = av.body.slots[0];
    const book = await request(app)
      .post("/api/bookings")
      .send({
        businessId: GROWTH_ID,
        serviceId: "cut",
        customer: { name: "Sam", phone: "+16135550002", email: "s@example.com" },
        slot: { start: slot.start, end: slot.end, timezone: "America/Toronto" },
        source: "web"
      });
    assert.strictEqual(book.status, 201, book.body?.error || "");
    assert.strictEqual(book.body.booking.providerId, null);
    await Booking.deleteOne({ id: book.body.booking.id });
  });

  it("DELETE provider soft-deactivates", async () => {
    const res = await internal(request(app).delete(`/api/businesses/${GROWTH_ID}/providers/${providerId}`));
    assert.strictEqual(res.status, 200);
    const list = await request(app).get(`/api/businesses/${GROWTH_ID}/providers`);
    assert.strictEqual(list.body.providers.length, 0);
  });
});

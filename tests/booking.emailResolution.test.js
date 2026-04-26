/**
 * Integration tests for BOO-MEM-1C: masked-email resolution in createBooking.
 *
 * Three scenarios:
 *  1. Masked email + matching prior booking → real email persisted on new booking
 *  2. Masked email + no matching prior booking → email is empty string on new booking
 *  3. Normal (non-masked) email → email persisted unchanged
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";

const BIZ_ID = "test-email-resolution-boo-mem-1c";
const SVC_ID = "haircut-30";
const PHONE_WITH_PRIOR = "+16132659661";
const PHONE_NO_PRIOR = "+16475559999";
const REAL_EMAIL = "waism@live.ca";
const MASKED_EMAIL = "wa***@live.ca";

// Unique slots to avoid overlap with other test suites
const PRIOR_BOOKING_SLOT = {
  start: "2027-09-10T09:00:00-04:00",
  end: "2027-09-10T09:30:00-04:00",
  timezone: "America/Toronto"
};
const SLOT_MASKED_RESOLVES = {
  start: "2027-09-10T11:00:00-04:00",
  end: "2027-09-10T11:30:00-04:00",
  timezone: "America/Toronto"
};
const SLOT_MASKED_NO_PRIOR = {
  start: "2027-09-10T13:00:00-04:00",
  end: "2027-09-10T13:30:00-04:00",
  timezone: "America/Toronto"
};
const SLOT_NORMAL_EMAIL = {
  start: "2027-09-10T15:00:00-04:00",
  end: "2027-09-10T15:30:00-04:00",
  timezone: "America/Toronto"
};

describe("createBooking — email resolution (BOO-MEM-1C)", () => {
  before(async () => {
    await Business.findOneAndUpdate(
      { id: BIZ_ID },
      {
        $set: {
          id: BIZ_ID,
          name: "Email Resolution Test Shop",
          timezone: "America/Toronto",
          plan: "growth"
        }
      },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: BIZ_ID, serviceId: SVC_ID },
      {
        $set: {
          businessId: BIZ_ID,
          serviceId: SVC_ID,
          name: "Haircut",
          durationMinutes: 30,
          active: true
        }
      },
      { upsert: true, new: true }
    );

    // Seed a prior booking with a real email for PHONE_WITH_PRIOR
    await Booking.findOneAndUpdate(
      { businessId: BIZ_ID, "slot.start": { $exists: true }, "customer.phone": PHONE_WITH_PRIOR },
      {
        $setOnInsert: {
          id: `bk_prior_email_res_test`,
          businessId: BIZ_ID,
          serviceId: SVC_ID,
          customer: {
            name: "Charles Test",
            phone: PHONE_WITH_PRIOR,
            email: REAL_EMAIL
          },
          slot: PRIOR_BOOKING_SLOT,
          status: "confirmed",
          source: "voice-agent",
          language: "en"
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Booking.deleteMany({ businessId: BIZ_ID });
    await Service.deleteMany({ businessId: BIZ_ID });
    await Business.deleteOne({ id: BIZ_ID });
  });

  it("masked email + matching prior booking → real email persisted on new booking", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: BIZ_ID,
        serviceId: SVC_ID,
        customer: {
          name: "Charles Test",
          phone: PHONE_WITH_PRIOR,
          email: MASKED_EMAIL
        },
        slot: SLOT_MASKED_RESOLVES,
        source: "voice-agent"
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.booking.customer.email, REAL_EMAIL);
  });

  it("masked email + no matching prior booking → email is empty string on new booking", async () => {
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: BIZ_ID,
        serviceId: SVC_ID,
        customer: {
          name: "Unknown Caller",
          phone: PHONE_NO_PRIOR,
          email: MASKED_EMAIL
        },
        slot: SLOT_MASKED_NO_PRIOR,
        source: "voice-agent"
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.booking.customer.email, "");
  });

  it("normal email → email persisted unchanged", async () => {
    const normalEmail = "hello@example.com";
    const res = await request(app)
      .post("/api/bookings")
      .send({
        businessId: BIZ_ID,
        serviceId: SVC_ID,
        customer: {
          name: "Regular Caller",
          phone: "+16135550001",
          email: normalEmail
        },
        slot: SLOT_NORMAL_EMAIL,
        source: "voice-agent"
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.booking.customer.email, normalEmail);
  });
});

/**
 * BOO-98A: booking.reschedule via POST /internal/execute-tool
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { fromZonedTime } from "date-fns-tz";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { Booking } from "../models/Booking.js";
import { generateBookingId, rescheduleBooking } from "../services/bookingService.js";

const TEST_BIZ = "test-boo98-reschedule";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";
const PHONE = "+15005553333";
const PHONE_OTHER = "+15005554444";
const TZ = "America/Toronto";

function internalAuth(req) {
  req.set("x-book8-internal-secret", INTERNAL_SECRET);
  return req;
}

function isoWall(ymdhm) {
  return fromZonedTime(ymdhm, TZ).toISOString();
}

describe("booking.reschedule (POST /internal/execute-tool)", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_BIZ },
      {
        $set: {
          id: TEST_BIZ,
          name: "Reschedule Test Biz",
          timezone: TZ,
          plan: "growth"
        }
      },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: TEST_BIZ, serviceId: "rs-60" },
      {
        $set: {
          businessId: TEST_BIZ,
          serviceId: "rs-60",
          name: "RS Service",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true, new: true }
    );
    await Schedule.findOneAndUpdate(
      { businessId: TEST_BIZ },
      {
        $set: {
          businessId: TEST_BIZ,
          timezone: TZ,
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
    await Booking.deleteMany({ businessId: TEST_BIZ });
    await Service.deleteMany({ businessId: TEST_BIZ });
    await Schedule.deleteOne({ businessId: TEST_BIZ });
    await Business.deleteOne({ id: TEST_BIZ });
  });

  it("happy path: moves booking to a new valid slot", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    const startOld = isoWall("2026-07-13T10:00:00");
    const endOld = isoWall("2026-07-13T11:00:00");
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "RS User", phone: PHONE },
      slot: { start: startOld, end: endOld, timezone: TZ },
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          bookingId: id,
          customerPhone: PHONE,
          newSlotStart: "2026-07-13T15:00:00",
          timezone: TZ,
          language: "en"
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.result.ok, true);
    assert.strictEqual(res.body.result.booking.bookingId, id);
    assert.ok(res.body.result.booking.newSlotLocalTime);

    const saved = await Booking.findOne({ id }).lean();
    assert.ok(saved.slot.start.includes("2026-07-13"));
    assert.notStrictEqual(saved.slot.start, startOld);
  });

  it("phone mismatch returns Booking not found", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "X", phone: PHONE },
      slot: {
        start: isoWall("2026-07-14T10:00:00"),
        end: isoWall("2026-07-14T11:00:00"),
        timezone: TZ
      },
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          bookingId: id,
          customerPhone: PHONE_OTHER,
          newSlotStart: "2026-07-14T15:00:00",
          timezone: TZ
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.result.message, "Booking not found");
  });

  it("rejects cancelled booking", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "X", phone: PHONE },
      slot: {
        start: isoWall("2026-07-15T10:00:00"),
        end: isoWall("2026-07-15T11:00:00"),
        timezone: TZ
      },
      status: "cancelled",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          bookingId: id,
          customerPhone: PHONE,
          newSlotStart: "2026-07-15T15:00:00",
          timezone: TZ
        }
      })
    );
    assert.strictEqual(res.body.ok, false);
    assert.ok(String(res.body.result.message).includes("cannot reschedule"));
  });

  it("rejects when current booking is already in the past", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "X", phone: PHONE },
      slot: {
        start: new Date("2020-01-15T15:00:00.000Z").toISOString(),
        end: new Date("2020-01-15T16:00:00.000Z").toISOString(),
        timezone: TZ
      },
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          bookingId: id,
          customerPhone: PHONE,
          newSlotStart: "2026-07-16T15:00:00",
          timezone: TZ
        }
      })
    );
    assert.strictEqual(res.body.ok, false);
    assert.ok(String(res.body.result.message).includes("passed"));
  });

  it("rejects new slot in the past", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "X", phone: PHONE },
      slot: {
        start: isoWall("2026-07-17T10:00:00"),
        end: isoWall("2026-07-17T11:00:00"),
        timezone: TZ
      },
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          bookingId: id,
          customerPhone: PHONE,
          newSlotStart: "2020-01-10T10:00:00",
          timezone: TZ
        }
      })
    );
    assert.strictEqual(res.body.ok, false);
    assert.ok(String(res.body.result.message).toLowerCase().includes("past"));
  });

  it("idempotent: same slot returns ok with message", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    const s = isoWall("2026-07-18T10:00:00");
    const e = isoWall("2026-07-18T11:00:00");
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "X", phone: PHONE },
      slot: { start: s, end: e, timezone: TZ },
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          bookingId: id,
          customerPhone: PHONE,
          newSlotStart: "2026-07-18T10:00:00",
          timezone: TZ
        }
      })
    );
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.result.message, "already scheduled at that time");
  });

  it("out of hours returns slot_unavailable and suggestedSlots", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "X", phone: PHONE },
      slot: {
        start: isoWall("2026-07-20T10:00:00"),
        end: isoWall("2026-07-20T11:00:00"),
        timezone: TZ
      },
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          bookingId: id,
          customerPhone: PHONE,
          newSlotStart: "2026-07-20T20:00:00",
          timezone: TZ
        }
      })
    );
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.result.error, "slot_unavailable");
    assert.ok(Array.isArray(res.body.result.suggestedSlots));
  });

  it("slot conflict returns suggestedSlots", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const a = generateBookingId();
    const b = generateBookingId();
    const occupied = isoWall("2026-07-21T15:00:00");
    const occupiedEnd = isoWall("2026-07-21T16:00:00");
    await Booking.create({
      id: a,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "A", phone: PHONE },
      slot: {
        start: isoWall("2026-07-21T10:00:00"),
        end: isoWall("2026-07-21T11:00:00"),
        timezone: TZ
      },
      status: "confirmed",
      source: "voice-agent"
    });
    await Booking.create({
      id: b,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "B", phone: PHONE_OTHER },
      slot: { start: occupied, end: occupiedEnd, timezone: TZ },
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          bookingId: a,
          customerPhone: PHONE,
          newSlotStart: "2026-07-21T15:00:00",
          timezone: TZ
        }
      })
    );
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.result.error, "slot_unavailable");
    assert.ok(Array.isArray(res.body.result.suggestedSlots));
  });

  it("direct rescheduleBooking returns gcalSynced false in test (no external API)", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "rs-60",
      customer: { name: "X", phone: PHONE },
      slot: {
        start: isoWall("2026-07-22T10:00:00"),
        end: isoWall("2026-07-22T11:00:00"),
        timezone: TZ
      },
      status: "confirmed",
      source: "voice-agent",
      calendarEventId: "evt_test_123"
    });

    const r = await rescheduleBooking({
      bookingId: id,
      customerPhone: PHONE,
      newSlotStart: "2026-07-22T14:00:00",
      timezone: TZ
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.booking.gcalSynced, false);
  });

  it("returns 400 when bookingId missing", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.reschedule",
        input: {
          customerPhone: PHONE,
          newSlotStart: "2026-07-23T10:00:00",
          timezone: TZ
        }
      })
    );
    assert.strictEqual(res.status, 400);
  });
});

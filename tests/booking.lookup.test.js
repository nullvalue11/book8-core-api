/**
 * BOO-97A: booking.lookup via POST /internal/execute-tool
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { generateBookingId, lookupBookingsByPhone } from "../services/bookingService.js";

const TEST_BIZ = "test-boo97-booking-lookup";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";
const PHONE = "+15005550001";
const PHONE_OTHER = "+15005550002";
const TZ = "America/Toronto";

function internalAuth(req) {
  req.set("x-book8-internal-secret", INTERNAL_SECRET);
  return req;
}

function slotIso(iso) {
  const end = new Date(new Date(iso).getTime() + 60 * 60000).toISOString();
  return { start: iso, end: end, timezone: TZ };
}

describe("booking.lookup (POST /internal/execute-tool)", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_BIZ },
      {
        $set: {
          id: TEST_BIZ,
          name: "Lookup Test Biz",
          timezone: TZ,
          plan: "growth"
        }
      },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: TEST_BIZ, serviceId: "lookup-svc" },
      {
        $set: {
          businessId: TEST_BIZ,
          serviceId: "lookup-svc",
          name: "Lookup Service",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    await Service.deleteMany({ businessId: TEST_BIZ });
    await Business.deleteOne({ id: TEST_BIZ });
  });

  it("returns matches when phone matches (non-cancelled)", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "lookup-svc",
      customer: { name: "Jane Lookup", phone: PHONE },
      slot: slotIso("2026-06-15T15:00:00.000Z"),
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.lookup",
        input: {
          businessId: TEST_BIZ,
          customerPhone: PHONE,
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30"
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.result.ok, true);
    assert.strictEqual(res.body.result.count, 1);
    assert.strictEqual(res.body.result.bookings[0].bookingId, id);
    assert.strictEqual(res.body.result.bookings[0].status, "confirmed");
    assert.ok(res.body.result.bookings[0].rescheduleUrl.includes(`/manage/${id}`));
    assert.strictEqual(res.body.result.bookings[0].serviceName, "Lookup Service");
    assert.strictEqual(res.body.result.bookings[0].serviceDurationMinutes, 60);
  });

  it("wrong phone returns empty bookings (not an error)", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    await Booking.create({
      id: generateBookingId(),
      businessId: TEST_BIZ,
      serviceId: "lookup-svc",
      customer: { name: "Other", phone: PHONE },
      slot: slotIso("2026-06-16T15:00:00.000Z"),
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.lookup",
        input: {
          businessId: TEST_BIZ,
          customerPhone: PHONE_OTHER,
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30"
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.result.ok, true);
    assert.strictEqual(res.body.result.count, 0);
    assert.deepStrictEqual(res.body.result.bookings, []);
  });

  it("excludes cancelled by default; includeCancelled includes them", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const cancelledId = generateBookingId();
    await Booking.create({
      id: cancelledId,
      businessId: TEST_BIZ,
      serviceId: "lookup-svc",
      customer: { name: "Cancelled", phone: PHONE },
      slot: slotIso("2026-06-17T15:00:00.000Z"),
      status: "cancelled",
      source: "voice-agent"
    });

    const without = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.lookup",
        input: {
          businessId: TEST_BIZ,
          customerPhone: PHONE,
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30",
          includeCancelled: false
        }
      })
    );
    assert.strictEqual(without.body.result.count, 0);

    const withCancelled = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.lookup",
        input: {
          businessId: TEST_BIZ,
          customerPhone: PHONE,
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30",
          includeCancelled: true
        }
      })
    );
    assert.strictEqual(withCancelled.body.result.count, 1);
    assert.strictEqual(withCancelled.body.result.bookings[0].bookingId, cancelledId);
    assert.strictEqual(withCancelled.body.result.bookings[0].status, "cancelled");
  });

  it("excludes bookings outside date range", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    await Booking.create({
      id: generateBookingId(),
      businessId: TEST_BIZ,
      serviceId: "lookup-svc",
      customer: { name: "Out", phone: PHONE },
      slot: slotIso("2026-08-15T15:00:00.000Z"),
      status: "confirmed",
      source: "voice-agent"
    });

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.lookup",
        input: {
          businessId: TEST_BIZ,
          customerPhone: PHONE,
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30"
        }
      })
    );
    assert.strictEqual(res.body.result.count, 0);
  });

  it("invalid phone returns failed with Invalid phone", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.lookup",
        input: {
          businessId: TEST_BIZ,
          customerPhone: "555-NOT-E164",
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30"
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.result?.ok, false);
    assert.strictEqual(res.body.result?.error, "Invalid phone");
  });

  it("missing businessId fails validation", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.lookup",
        input: {
          customerPhone: PHONE,
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30"
        }
      })
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
  });

  it("lookupBookingsByPhone: missing businessId returns businessId is required", async () => {
    const r = await lookupBookingsByPhone({
      customerPhone: PHONE,
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30"
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, "businessId is required");
  });

  it("limit 999 is capped at 10", async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
    const rows = [];
    for (let i = 0; i < 12; i++) {
      const hour = 8 + i;
      rows.push({
        id: generateBookingId(),
        businessId: TEST_BIZ,
        serviceId: "lookup-svc",
        customer: { name: `User ${i}`, phone: PHONE },
        slot: slotIso(`2026-06-20T${String(hour).padStart(2, "0")}:00:00.000Z`),
        status: "confirmed",
        source: "voice-agent"
      });
    }
    await Booking.insertMany(rows);

    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.lookup",
        input: {
          businessId: TEST_BIZ,
          customerPhone: PHONE,
          dateFrom: "2026-06-01",
          dateTo: "2026-06-30",
          limit: 999
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.result.count, 10);
    assert.strictEqual(res.body.result.bookings.length, 10);
  });
});

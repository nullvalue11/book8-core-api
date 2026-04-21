/**
 * BOO-107A: naïve slot strings parsed in business IANA timezone
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import {
  parseSlotInTimezone,
  parseSlotInstantForStorage
} from "../services/timeUtils.js";
import { createBooking } from "../services/bookingService.js";

describe("timeUtils parseSlotInTimezone (BOO-107A)", () => {
  it("11 AM Toronto April (EDT) → 15:00 UTC", () => {
    const d = parseSlotInTimezone("2026-04-22T11:00:00", "America/Toronto");
    assert.strictEqual(d.toISOString(), "2026-04-22T15:00:00.000Z");
  });

  it("11 AM Toronto January (EST) → 16:00 UTC", () => {
    const d = parseSlotInTimezone("2026-01-15T11:00:00", "America/Toronto");
    assert.strictEqual(d.toISOString(), "2026-01-15T16:00:00.000Z");
  });

  it("rejects input with Z", () => {
    assert.throws(() => parseSlotInTimezone("2026-04-22T11:00:00Z", "America/Toronto"), /timezone designator/);
  });

  it("rejects input with numeric offset", () => {
    assert.throws(
      () => parseSlotInTimezone("2026-04-22T11:00:00-04:00", "America/Toronto"),
      /timezone designator/
    );
  });

  it("rejects missing timezone", () => {
    assert.throws(() => parseSlotInTimezone("2026-04-22T11:00:00", ""), /timezone is required/);
  });

  it("rejects invalid ISO", () => {
    assert.throws(
      () => parseSlotInTimezone("2026-13-45T99:00:00", "America/Toronto"),
      /invalid ISO/i
    );
  });

  it("parseSlotInstantForStorage: absolute ISO unchanged instant", () => {
    const d = parseSlotInstantForStorage("2026-04-22T15:00:00.000Z", "America/Toronto");
    assert.strictEqual(d.toISOString(), "2026-04-22T15:00:00.000Z");
  });

  it("parseSlotInstantForStorage: offset string uses Date semantics", () => {
    const d = parseSlotInstantForStorage("2026-03-08T14:00:00-05:00", "America/Toronto");
    assert.strictEqual(d.toISOString(), "2026-03-08T19:00:00.000Z");
  });
});

const TEST_BIZ = "test-boo107-tz-create";

describe("createBooking naive wall time (BOO-107A)", () => {
  before(async () => {
    await Business.findOneAndUpdate(
      { id: TEST_BIZ },
      {
        $set: {
          id: TEST_BIZ,
          name: "TZ Create Test",
          timezone: "America/Toronto",
          plan: "growth"
        }
      },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: TEST_BIZ, serviceId: "svc-60-tz" },
      {
        $set: {
          businessId: TEST_BIZ,
          serviceId: "svc-60-tz",
          name: "One Hour",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Booking.deleteMany({ businessId: TEST_BIZ });
  });

  it("noop app bootstrap", () => {
    assert.ok(app);
  });

  it("naïve 11 AM June Toronto → Mongo stores correct UTC (EDT)", async () => {
    const r = await createBooking({
      businessId: TEST_BIZ,
      serviceId: "svc-60-tz",
      customer: { name: "Wall Clock", phone: "+15005551234" },
      slot: {
        start: "2028-06-15T11:00:00",
        end: "2028-06-15T12:00:00",
        timezone: "America/Toronto"
      },
      source: "voice-agent"
    });
    assert.strictEqual(r.ok, true, r.error || JSON.stringify(r));
    const doc = await Booking.findOne({ id: r.booking.id }).lean();
    assert.strictEqual(doc.slot.start, "2028-06-15T15:00:00.000Z");
    assert.strictEqual(doc.slot.end, "2028-06-15T16:00:00.000Z");
    await Booking.deleteOne({ id: r.booking.id });
  });
});

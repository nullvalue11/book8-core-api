/**
 * BOO-102A: reschedule succeeds when GCal returns invalid/HTML body
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { app } from "../index.js";
import { Booking } from "../models/Booking.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { generateBookingId, rescheduleBooking } from "../services/bookingService.js";
import { fromZonedTime } from "date-fns-tz";

const TEST_BIZ = "test-boo102-gcal-resched";
const PHONE = "+15005557777";
const TZ = "America/Toronto";
const realFetch = global.fetch;

function isoWall(ymdhm) {
  return fromZonedTime(ymdhm, TZ).toISOString();
}

describe("bookingService gcal non-blocking (BOO-102A)", () => {
  before(async () => {
    process.env.GCAL_INTEGRATION_TEST = "1";
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = "test-internal-secret";

    await Business.findOneAndUpdate(
      { id: TEST_BIZ },
      {
        $set: {
          id: TEST_BIZ,
          name: "GCal NB Test",
          timezone: TZ,
          plan: "growth",
          calendarProvider: "google"
        }
      },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: TEST_BIZ, serviceId: "gcal-60" },
      {
        $set: {
          businessId: TEST_BIZ,
          serviceId: "gcal-60",
          name: "GCal Service",
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
    delete process.env.GCAL_INTEGRATION_TEST;
    global.fetch = realFetch;
    await Booking.deleteMany({ businessId: TEST_BIZ });
  });

  it("noop app import", () => {
    assert.ok(app);
  });

  it("rescheduleBooking ok:true and gcalSync.failed when patch returns HTML body", async () => {
    global.fetch = async (url) => {
      if (String(url).includes("gcal-update-event") || String(url).includes("outlook-update-event")) {
        return {
          ok: true,
          status: 200,
          text: async () => '<!DOCTYPE html><html><body>OAuth</body></html>'
        };
      }
      if (typeof realFetch === "function") {
        return realFetch(url);
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    await Booking.deleteMany({ businessId: TEST_BIZ });
    const id = generateBookingId();
    await Booking.create({
      id,
      businessId: TEST_BIZ,
      serviceId: "gcal-60",
      customer: { name: "Pat", phone: PHONE },
      slot: {
        start: isoWall("2026-08-12T10:00:00"),
        end: isoWall("2026-08-12T11:00:00"),
        timezone: TZ
      },
      status: "confirmed",
      source: "voice-agent",
      calendarEventId: "evt_oauth_dead"
    });

    const r = await rescheduleBooking({
      bookingId: id,
      customerPhone: PHONE,
      newSlotStart: "2026-08-12T14:00:00",
      timezone: TZ
    });

    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.booking.gcalSynced, false);

    const doc = await Booking.findOne({ id }).lean();
    assert.ok(doc?.gcalSync);
    assert.strictEqual(doc.gcalSync.status, "failed");
    assert.strictEqual(doc.gcalSync.failureCount, 1);
    assert.ok(doc.gcalSync.lastError);
  });
});

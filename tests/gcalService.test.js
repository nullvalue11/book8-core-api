/**
 * BOO-102A: gcalService safe parsing + structured results
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import {
  classifyGcalError,
  patchCalendarEventSchedule,
  moveCalendarEvent
} from "../services/gcalService.js";

const realFetch = global.fetch;

describe("gcalService (BOO-102A)", () => {
  before(() => {
    process.env.GCAL_INTEGRATION_TEST = "1";
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = "test-internal-secret-gcal";
  });

  after(() => {
    delete process.env.GCAL_INTEGRATION_TEST;
    global.fetch = realFetch;
  });

  it("classifyGcalError: HTML body → token_expired", () => {
    assert.strictEqual(classifyGcalError(null, 200, "<!DOCTYPE html><html>"), "token_expired");
    assert.strictEqual(classifyGcalError(null, 500, "<html><body>x</body>"), "token_expired");
  });

  it("classifyGcalError: HTTP status", () => {
    assert.strictEqual(classifyGcalError(null, 404, "{}"), "not_found");
    assert.strictEqual(classifyGcalError(null, 429, "{}"), "rate_limited");
    assert.strictEqual(classifyGcalError(null, 401, "{}"), "token_expired");
  });

  it("classifyGcalError: network-ish", () => {
    const e = new Error("fetch failed");
    assert.strictEqual(classifyGcalError(e), "network");
  });

  it("patchCalendarEventSchedule: HTML 200 body → ok false, token_expired", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '<!DOCTYPE html><html><head></head><body>Google Login</body></html>'
    });
    const r = await patchCalendarEventSchedule({
      businessId: "b1",
      eventId: "evt_cal_1",
      calendarProvider: "google",
      start: "2026-07-22T14:00:00.000Z",
      end: "2026-07-22T15:00:00.000Z",
      timezone: "America/Toronto"
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.errorType, "token_expired");
    assert.ok(typeof r.message === "string");
  });

  it("moveCalendarEvent is an alias for patchCalendarEventSchedule", () => {
    assert.strictEqual(moveCalendarEvent, patchCalendarEventSchedule);
  });
});

/**
 * BOO-117: POST /internal/business/sync-calendar-state
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";

const TEST_BIZ = "test-boo117-sync-cal";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

function internalAuth(req) {
  req.set("x-book8-internal-secret", INTERNAL_SECRET);
  return req;
}

describe("POST /internal/business/sync-calendar-state (BOO-117)", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_BIZ },
      {
        $set: {
          id: TEST_BIZ,
          name: "Sync cal test",
          timezone: "America/Toronto",
          plan: "growth",
          calendarProvider: null,
          "calendar.connected": false,
          "calendar.provider": null
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Business.deleteOne({ id: TEST_BIZ });
  });

  it("returns 400 without businessId", async () => {
    const res = await internalAuth(
      request(app).post("/internal/business/sync-calendar-state").send({
        calendar: { connected: true }
      })
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
  });

  it("returns 400 when no calendar fields", async () => {
    const res = await internalAuth(
      request(app).post("/internal/business/sync-calendar-state").send({
        businessId: TEST_BIZ
      })
    );
    assert.strictEqual(res.status, 400);
  });

  it("updates Business calendar fields", async () => {
    const connectedAt = "2026-04-20T18:30:00.000Z";
    const res = await internalAuth(
      request(app).post("/internal/business/sync-calendar-state").send({
        businessId: TEST_BIZ,
        calendarProvider: "google",
        calendar: {
          connected: true,
          provider: "google",
          connectedAt,
          calendarId: "primary",
          lastSyncedAt: null
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);

    const doc = await Business.findOne({ id: TEST_BIZ }).lean();
    assert.strictEqual(doc.calendarProvider, "google");
    assert.strictEqual(doc.calendar.connected, true);
    assert.strictEqual(doc.calendar.provider, "google");
    assert.strictEqual(doc.calendar.calendarId, "primary");
    assert.ok(doc.calendar.connectedAt);
    assert.ok(doc.calendar.lastSyncedAt == null);
  });

  it("returns ok:true skipped when business missing", async () => {
    const res = await internalAuth(
      request(app)
        .post("/internal/business/sync-calendar-state")
        .send({
          businessId: "biz_nonexistent_boo117_xyz",
          calendar: { connected: true, provider: "google" },
          calendarProvider: "google"
        })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.skipped, true);
  });
});

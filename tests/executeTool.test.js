/**
 * Execution-layer tests for internal execute-tool: tenant.ensure, calendar.availability, booking.create
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { Booking } from "../models/Booking.js";

const TEST_BUSINESS_ID = "test-execute-tool-gym";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

function internalAuth(req) {
  req.set("x-book8-internal-secret", INTERNAL_SECRET);
  return req;
}

describe("POST /internal/execute-tool", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_BUSINESS_ID },
      { $set: { id: TEST_BUSINESS_ID, name: "Execute Tool Gym", timezone: "America/Toronto" } },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: TEST_BUSINESS_ID, serviceId: "pt-60" },
      {
        $set: {
          businessId: TEST_BUSINESS_ID,
          serviceId: "pt-60",
          name: "PT",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true, new: true }
    );
    await Schedule.findOneAndUpdate(
      { businessId: TEST_BUSINESS_ID },
      {
        $set: {
          businessId: TEST_BUSINESS_ID,
          timezone: "America/Toronto",
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
    await Booking.deleteMany({ businessId: TEST_BUSINESS_ID });
    await Service.deleteMany({ businessId: TEST_BUSINESS_ID });
    await Schedule.deleteOne({ businessId: TEST_BUSINESS_ID });
    await Business.deleteOne({ id: TEST_BUSINESS_ID });
    await mongoose.connection.close();
  });

  it("returns 400 when tool is missing", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({ input: {} })
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.status, "failed");
  });

  it("tenant.ensure: succeeded when business already exists", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "tenant.ensure",
        input: { businessId: TEST_BUSINESS_ID, name: "Execute Tool Gym" }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "succeeded");
    assert.strictEqual(res.body.tool, "tenant.ensure");
    assert.strictEqual(res.body.result.existed, true);
    assert.strictEqual(res.body.result.created, false);
  });

  it("tenant.ensure: succeeded when creating new business and ensures defaults", async () => {
    const newId = "test-tenant-ensure-new-" + Date.now();
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "tenant.ensure",
        input: { businessId: newId, name: "New Tenant Business" }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.result.existed, false);
    assert.strictEqual(res.body.result.created, true);
    assert.strictEqual(res.body.result.businessId, newId);
    assert.strictEqual(res.body.result.defaultsEnsured, true);
    await Service.deleteMany({ businessId: newId });
    await Schedule.deleteOne({ businessId: newId });
    await Business.deleteOne({ id: newId });
  });

  it("tenant.ensure: failed when businessId or name missing", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "tenant.ensure",
        input: { businessId: "some-id" }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.status, "failed");
    assert.ok(res.body.error?.message?.includes("name"));
  });

  it("calendar.availability: succeeded with valid input", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "calendar.availability",
        input: {
          businessId: TEST_BUSINESS_ID,
          serviceId: "pt-60",
          from: "2026-03-08T00:00:00-05:00",
          to: "2026-03-09T00:00:00-05:00",
          timezone: "America/Toronto",
          durationMinutes: 60
        },
        requestId: "req-1",
        executionKey: "exec-1"
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "succeeded");
    assert.strictEqual(res.body.tool, "calendar.availability");
    assert.strictEqual(res.body.tenantId, TEST_BUSINESS_ID);
    assert.strictEqual(res.body.requestId, "req-1");
    assert.strictEqual(res.body.executionKey, "exec-1");
    assert.ok(res.body.result?.slots !== undefined);
    assert.strictEqual(res.body.error, null);
  });

  it("calendar.availability: failed when businessId or serviceId missing", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "calendar.availability",
        input: {
          from: "2026-03-08T00:00:00-05:00",
          to: "2026-03-09T00:00:00-05:00"
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.status, "failed");
    assert.strictEqual(res.body.tool, "calendar.availability");
    assert.ok(res.body.error?.message);
  });

  it("booking.create: succeeded with valid input", async () => {
    const slot = {
      start: "2026-03-10T14:00:00-05:00",
      end: "2026-03-10T15:00:00-05:00",
      timezone: "America/Toronto"
    };
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.create",
        input: {
          businessId: TEST_BUSINESS_ID,
          serviceId: "pt-60",
          customer: { name: "Tool User", phone: "+16475559999", email: "tool@example.com" },
          slot,
          notes: "From execute-tool test",
          source: "voice-agent"
        }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "succeeded");
    assert.strictEqual(res.body.tool, "booking.create");
    assert.strictEqual(res.body.tenantId, TEST_BUSINESS_ID);
    assert.ok(res.body.result?.booking?.id?.startsWith("bk_"));
    assert.ok(res.body.result?.summary);
    assert.strictEqual(res.body.error, null);
  });

  it("booking.create: failed when required fields missing", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.create",
        input: { businessId: TEST_BUSINESS_ID }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.status, "failed");
    assert.strictEqual(res.body.tool, "booking.create");
    assert.ok(res.body.error?.message);
  });

  it("ops.getResult: succeeded with result", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "ops.getResult",
        input: { result: { foo: "bar" } }
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.status, "succeeded");
    assert.strictEqual(res.body.tool, "ops.getResult");
    assert.deepStrictEqual(res.body.result, { foo: "bar" });
  });

  it("booking.create: failed on slot conflict", async () => {
    const slot = {
      start: "2026-03-11T16:00:00-05:00",
      end: "2026-03-11T17:00:00-05:00",
      timezone: "America/Toronto"
    };
    const first = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.create",
        input: {
          businessId: TEST_BUSINESS_ID,
          serviceId: "pt-60",
          customer: { name: "First", phone: "+16475550001" },
          slot,
          source: "voice-agent"
        }
      })
    );
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.ok, true);

    const second = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.create",
        input: {
          businessId: TEST_BUSINESS_ID,
          serviceId: "pt-60",
          customer: { name: "Second", phone: "+16475550002" },
          slot,
          source: "voice-agent"
        }
      })
    );
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.ok, false);
    assert.strictEqual(second.body.status, "failed");
    assert.ok(second.body.error?.message?.toLowerCase().includes("available") || second.body.error?.message?.toLowerCase().includes("slot"));
  });

  it("returns failed for unknown tool", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "unknown.tool",
        input: {}
      })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.status, "failed");
    assert.ok(res.body.error?.message?.includes("Unknown tool"));
  });
});

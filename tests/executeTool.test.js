/**
 * Execution-layer tests for internal execute-tool: calendar.availability, booking.create
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
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
      {
        $set: {
          id: TEST_BUSINESS_ID,
          name: "Execute Tool Gym",
          timezone: "America/Toronto",
          services: [{ id: "pt-60", name: "PT", duration: 60, price: 80 }]
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Booking.deleteMany({ businessId: TEST_BUSINESS_ID });
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

  it("calendar.availability: failed when businessId missing", async () => {
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

/**
 * BOO-DEMO-PROMPT-NOTOOLS-1A — demo line execute-tool guardrail
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../index.js";

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

function internalAuth(req) {
  req.set("x-book8-internal-secret", INTERNAL_SECRET);
  return req;
}

describe("Demo line guardrail", () => {
  before(() => {
    if (!process.env.INTERNAL_API_SECRET) {
      process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    }
  });

  it("blocks calendar.availability for biz_book8demo", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "calendar.availability",
        input: {
          businessId: "biz_book8demo",
          serviceId: "ser_fake_test",
          date: "2026-05-23",
          timezone: "America/Toronto"
        }
      })
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.status, "demo_mode");
    assert.equal(res.body.error_code, "tools_disabled_for_demo");
  });

  it("blocks booking.create for biz_book8demo", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "booking.create",
        input: {
          businessId: "biz_book8demo",
          serviceId: "ser_fake_test",
          startTime: "2026-05-23T16:00:00-04:00",
          customerName: "Test Customer",
          customerPhone: "+16135551234"
        }
      })
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.error_code, "tools_disabled_for_demo");
  });

  it("does NOT block tools for real businesses", async () => {
    const res = await internalAuth(
      request(app).post("/internal/execute-tool").send({
        tool: "calendar.availability",
        input: {
          businessId: "biz_mnmqsh4xnfygae",
          serviceId: "ser_real_test",
          date: "2026-05-23",
          timezone: "America/Toronto"
        }
      })
    );

    assert.notEqual(res.body.error_code, "tools_disabled_for_demo");
  });
});

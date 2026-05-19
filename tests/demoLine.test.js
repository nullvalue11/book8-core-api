/**
 * BOO-DEMO-LINE-1A
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_BUSINESS_ID,
  isDemoLineBusiness,
  isDemoBlockedBookingTool,
  simulatedDemoBookingOutcome
} from "../src/utils/demoLine.js";

describe("demoLine", () => {
  it("isDemoLineBusiness detects category and metadata", () => {
    assert.equal(isDemoLineBusiness({ category: "demo" }), true);
    assert.equal(isDemoLineBusiness({ id: DEMO_BUSINESS_ID }), true);
    assert.equal(isDemoLineBusiness({ metadata: { isDemoLine: true } }), true);
    assert.equal(isDemoLineBusiness({ id: "biz_other", category: "salon" }), false);
  });

  it("isDemoBlockedBookingTool covers write tools", () => {
    assert.equal(isDemoBlockedBookingTool("booking.create"), true);
    assert.equal(isDemoBlockedBookingTool("booking.reschedule"), true);
    assert.equal(isDemoBlockedBookingTool("booking.cancel"), true);
    assert.equal(isDemoBlockedBookingTool("calendar.availability"), false);
  });

  it("simulatedDemoBookingOutcome marks simulated", () => {
    const r = simulatedDemoBookingOutcome("booking.create");
    assert.equal(r.ok, true);
    assert.equal(r.result.simulated, true);
    assert.match(r.result.simulated_booking_id, /^demo_/);
  });
});

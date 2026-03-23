/**
 * Unit tests for SMS booking parse helpers (no DB).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  resolveDate,
  resolveTime,
  matchTimeToSlot,
  resolveSmsTimezone
} from "../services/smsBookingConversation.js";

describe("resolveSmsTimezone", () => {
  it("prefers weeklySchedule.timezone over business.timezone", () => {
    assert.strictEqual(
      resolveSmsTimezone({
        timezone: "America/Vancouver",
        weeklySchedule: { timezone: "America/Toronto" }
      }),
      "America/Toronto"
    );
  });
});

describe("resolveTime", () => {
  it("parses 4pm to 16:00", () => {
    assert.strictEqual(resolveTime("4pm"), "16:00");
  });
  it("parses 4 pm with space", () => {
    assert.strictEqual(resolveTime("4 pm"), "16:00");
  });
  it("parses 2:30pm", () => {
    assert.strictEqual(resolveTime("2:30pm"), "14:30");
  });
});

describe("matchTimeToSlot", () => {
  const tz = "America/Toronto";
  const slots = [
    { start: "2026-03-23T20:00:00.000Z", end: "2026-03-23T21:00:00.000Z" } // depends on offset
  ];
  it("returns a slot for 4pm token when hour matches in TZ", () => {
    const token = resolveTime("4pm");
    const slot = matchTimeToSlot(token, slots, tz);
    assert.ok(slot);
  });
});

describe("resolveDate", () => {
  it("returns YYYY-MM-DD for tomorrow relative to ref (chrono)", () => {
    const d = resolveDate("tomorrow", "America/Toronto");
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(d), d);
  });
  it("parses March 23rd, 2026 with ordinals and comma", () => {
    const d = resolveDate("March 23rd, 2026", "America/Toronto");
    assert.strictEqual(d, "2026-03-23");
  });
});

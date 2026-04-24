/**
 * BOO-115A: todayInTimezone helper
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { todayInTimezone } from "../services/timeUtils.js";

describe("todayInTimezone (BOO-115A)", () => {
  it("Apr 24 00:33 UTC → still Apr 23 in Toronto (EDT)", () => {
    const now = new Date("2026-04-24T00:33:00.000Z");
    assert.strictEqual(todayInTimezone("America/Toronto", now), "2026-04-23");
  });

  it("Jan 15 04:30 UTC → Jan 14 in Toronto (EST)", () => {
    const now = new Date("2026-01-15T04:30:00.000Z");
    assert.strictEqual(todayInTimezone("America/Toronto", now), "2026-01-14");
  });

  it("Apr 23 20:00 UTC → Apr 24 in Asia/Dubai", () => {
    const now = new Date("2026-04-23T20:00:00.000Z");
    assert.strictEqual(todayInTimezone("Asia/Dubai", now), "2026-04-24");
  });

  it("missing timezone throws", () => {
    assert.throws(() => todayInTimezone(""), /timezone is required/);
    assert.throws(() => todayInTimezone(null), /timezone is required/);
  });

  it("invalid timezone throws with reason", () => {
    assert.throws(
      () => todayInTimezone("NotA/ValidZone_XYZ", new Date("2026-04-01T12:00:00.000Z")),
      /invalid zone/i
    );
  });
});

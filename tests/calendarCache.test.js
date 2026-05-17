/**
 * BOO-PERF-GCAL-CACHE-1A: calendarCache unit tests
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

describe("calendarCache", () => {
  let mod;

  beforeEach(async () => {
    process.env.CALENDAR_CACHE_ENABLED = "true";
    const url = new URL("../services/calendarCache.js", import.meta.url);
    url.searchParams.set("t", String(Date.now()));
    mod = await import(url.href);
  });

  after(() => {
    delete process.env.CALENDAR_CACHE_ENABLED;
  });

  it("get/set round-trip per businessId + date + timezone", () => {
    const busy = [{ start: "2026-05-19T08:00:00-04:00", end: "2026-05-19T09:00:00-04:00" }];
    mod.setBusyTimes("biz_a", "2026-05-19", "America/Toronto", busy);
    const got = mod.getBusyTimes("biz_a", "2026-05-19", "America/Toronto");
    assert.deepEqual(got, busy);
  });

  it("invalidateBusinessDate removes all timezone keys for that date", () => {
    mod.setBusyTimes("biz_b", "2026-05-20", "America/Toronto", []);
    mod.setBusyTimes("biz_b", "2026-05-20", "America/New_York", []);
    mod.setBusyTimes("biz_b", "2026-05-21", "America/Toronto", []);
    const n = mod.invalidateBusinessDate("biz_b", "2026-05-20");
    assert.equal(n, 2);
    assert.equal(mod.getBusyTimes("biz_b", "2026-05-20", "America/Toronto"), null);
    assert.ok(mod.getBusyTimes("biz_b", "2026-05-21", "America/Toronto"));
  });

  it("CALENDAR_CACHE_ENABLED=false disables reads and writes", async () => {
    process.env.CALENDAR_CACHE_ENABLED = "false";
    const url = new URL("../services/calendarCache.js", import.meta.url);
    url.searchParams.set("t", String(Date.now() + 1));
    const disabled = await import(url.href);
    disabled.setBusyTimes("biz_c", "2026-05-19", "America/Toronto", [{ start: "x", end: "y" }]);
    assert.equal(disabled.getBusyTimes("biz_c", "2026-05-19", "America/Toronto"), null);
    assert.equal(disabled.stats().enabled, false);
  });

  it("slotToDateISO uses business timezone", () => {
    const dateISO = mod.slotToDateISO("2026-05-20T03:00:00.000Z", "America/Toronto");
    assert.equal(dateISO, "2026-05-19");
  });
});

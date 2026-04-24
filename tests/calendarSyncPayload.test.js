/**
 * BOO-117: buildCalendarSyncUpdate pure helper
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildCalendarSyncUpdate,
  normalizeCalendarProviderValue
} from "../src/utils/calendarSyncPayload.js";

describe("calendarSyncPayload (BOO-117)", () => {
  it("normalizeCalendarProviderValue maps outlook → microsoft", () => {
    assert.strictEqual(normalizeCalendarProviderValue("outlook"), "microsoft");
    assert.strictEqual(normalizeCalendarProviderValue("GOOGLE"), "google");
    assert.strictEqual(normalizeCalendarProviderValue(null), null);
  });

  it("buildCalendarSyncUpdate applies partial calendar + top-level provider", () => {
    const $set = buildCalendarSyncUpdate({
      calendarProvider: "google",
      calendar: {
        connected: true,
        connectedAt: "2026-01-15T12:00:00.000Z",
        provider: "google"
      }
    });
    assert.strictEqual($set.calendarProvider, "google");
    assert.strictEqual($set["calendar.connected"], true);
    assert.strictEqual($set["calendar.provider"], "google");
    assert.ok($set["calendar.connectedAt"] instanceof Date);
    assert.ok($set["calendar.updatedAt"] instanceof Date);
  });

  it("buildCalendarSyncUpdate returns empty when nothing to apply", () => {
    const $set = buildCalendarSyncUpdate({});
    assert.deepStrictEqual($set, {});
  });
});

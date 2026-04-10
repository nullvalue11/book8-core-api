import { describe, it } from "node:test";
import assert from "node:assert";
import {
  utcCalendarDaysSinceTrialStart,
  notificationsForUtcDayIndex,
  notificationAlreadySent
} from "../services/trialNotifications.js";
import { buildTrialEmailInner, trialSmsText } from "../services/templates/trialDripI18n.js";

describe("trialNotifications (BOO-99A)", () => {
  it("utcCalendarDaysSinceTrialStart counts UTC calendar days", () => {
    const start = new Date(Date.UTC(2026, 2, 1, 15, 0, 0));
    const d0 = new Date(Date.UTC(2026, 2, 1, 8, 0, 0));
    const d9 = new Date(Date.UTC(2026, 2, 10, 8, 0, 0));
    assert.strictEqual(utcCalendarDaysSinceTrialStart(start, d0), 0);
    assert.strictEqual(utcCalendarDaysSinceTrialStart(start, d9), 9);
  });

  it("notificationsForUtcDayIndex matches drip schedule", () => {
    assert.strictEqual(notificationsForUtcDayIndex(8, false).length, 0);
    assert.strictEqual(notificationsForUtcDayIndex(9, false).length, 1);
    assert.ok(notificationsForUtcDayIndex(9, false)[0].id.includes("day-10"));
    assert.strictEqual(notificationsForUtcDayIndex(13, false).length, 2);
    assert.strictEqual(notificationsForUtcDayIndex(20, false).length, 0);
    assert.strictEqual(notificationsForUtcDayIndex(20, true).length, 1);
  });

  it("notificationAlreadySent reads notifications.sent", () => {
    const b = { notifications: { sent: [{ type: "trial-day-10-email", channel: "email" }] } };
    assert.strictEqual(notificationAlreadySent(b, "trial-day-10-email"), true);
    assert.strictEqual(notificationAlreadySent(b, "trial-day-13-email"), false);
  });

  it("buildTrialEmailInner includes CTA link", () => {
    const { body } = buildTrialEmailInner("en", "day13", {
      firstName: "Alex",
      upgradeUrl: "https://book8.io/upgrade?businessId=x&utm_campaign=day_13"
    });
    assert.ok(body.includes("Upgrade to Growth"));
    assert.ok(body.includes("book8.io/upgrade"));
  });

  it("trialSmsText stays reasonably short", () => {
    const t = trialSmsText("en", "day15", "https://book8.io/upgrade?b=1");
    assert.ok(t.length <= 200);
  });
});

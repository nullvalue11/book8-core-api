/**
 * BOO-102A — Monthly insights recap cron + i18n helpers
 */
import { describe, it, before } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { runMonthlyInsightsRecap } from "../services/monthlyInsightsRecap.js";
import { previousMonthRange } from "../services/insights/computeBusinessInsights.js";
import { buildMonthlyRecapEmail } from "../services/templates/monthlyInsightsI18n.js";
import { Business } from "../models/Business.js";
import { notificationAlreadySent } from "../services/trialNotifications.js";

const CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret";

describe("monthly insights recap (BOO-102A)", () => {
  it("previousMonthRange labels March when run on April 1 UTC", () => {
    const now = new Date(Date.UTC(2026, 3, 1, 9, 0, 0));
    const r = previousMonthRange(now);
    assert.strictEqual(r.label, "March 2026");
    assert.strictEqual(r.dedupKey, "monthly-insights-March-2026");
    assert.ok(r.fromIso < r.toIso);
  });

  it("runMonthlyInsightsRecap skips when not 1st UTC without forceFire", async () => {
    const mid = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));
    const r = await runMonthlyInsightsRecap({ now: mid, forceFire: false });
    assert.strictEqual(r.skipped, "not_first_of_month");
    assert.strictEqual(r.sent, 0);
  });

  it("runMonthlyInsightsRecap runs when forceFire true on non-1st", async () => {
    const mid = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));
    const r = await runMonthlyInsightsRecap({ now: mid, forceFire: true });
    assert.strictEqual(r.skipped, undefined);
    assert.ok(typeof r.processed === "number");
    assert.ok(typeof r.sent === "number");
  });

  it("buildMonthlyRecapEmail subject interpolates bookings and revenue (EN)", () => {
    const { subject } = buildMonthlyRecapEmail("en", {
      firstName: "Alex",
      businessName: "Test Spa",
      monthLabel: "March 2026",
      current: {
        bookingsCount: 47,
        callsCount: 89,
        callsOutsideHours: 12,
        revenue: 14600,
        currency: "USD",
        languageCounts: { en: 65, fr: 16 },
        topServices: [
          { name: "Full Wash", bookingsCount: 18, revenue: 5400, currency: "USD" }
        ]
      },
      prior: { bookingsCount: 32, revenue: 11200 },
      insightsUrl: "https://www.book8.io/dashboard/insights"
    });
    assert.ok(subject.includes("47"));
    assert.ok(subject.includes("14,600") || subject.includes("14600"));
  });

  it("buildMonthlyRecapEmail uses French copy when lang is fr", () => {
    const { subject } = buildMonthlyRecapEmail("fr", {
      firstName: "Marie",
      businessName: "Salon",
      monthLabel: "mars 2026",
      current: {
        bookingsCount: 10,
        callsCount: 5,
        callsOutsideHours: 0,
        revenue: 1000,
        currency: "EUR",
        languageCounts: { fr: 5 },
        topServices: []
      },
      prior: { bookingsCount: 8, revenue: 800 },
      insightsUrl: "https://www.book8.io/dashboard/insights"
    });
    assert.ok(subject.toLowerCase().includes("book8") || subject.includes("Book8"));
    assert.ok(subject.includes("10"));
  });

  it("notificationAlreadySent detects monthly dedup key", () => {
    const b = {
      notifications: {
        sent: [{ type: "monthly-insights-March-2026", channel: "email" }]
      }
    };
    assert.strictEqual(notificationAlreadySent(b, "monthly-insights-March-2026"), true);
    assert.strictEqual(notificationAlreadySent(b, "monthly-insights-April-2026"), false);
  });
});

describe("GET /api/cron/monthly-insights-recap", () => {
  before(() => {
    if (!process.env.CRON_SECRET) process.env.CRON_SECRET = CRON_SECRET;
  });

  it("returns 401 without Bearer token", async () => {
    const res = await request(app).get("/api/cron/monthly-insights-recap");
    assert.strictEqual(res.status, 401);
  });

  it("returns ok with skipped on non-1st without forceFire", async () => {
    const res = await request(app)
      .get("/api/cron/monthly-insights-recap")
      .set("Authorization", `Bearer ${CRON_SECRET}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    if (new Date().getUTCDate() !== 1) {
      assert.strictEqual(res.body.skipped, "not_first_of_month");
    }
  });

  it("forceFire=1 avoids not_first_of_month skip", async () => {
    const res = await request(app)
      .get("/api/cron/monthly-insights-recap?forceFire=1")
      .set("Authorization", `Bearer ${CRON_SECRET}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.notStrictEqual(res.body.skipped, "not_first_of_month");
  });
});

describe("PATCH /api/businesses/:id/notification-preferences", () => {
  const TEST_ID = "test-monthly-recap-pref";
  const API_KEY = process.env.BOOK8_CORE_API_KEY || "test-api-key";
  const INTERNAL = process.env.INTERNAL_API_SECRET || "test-internal-secret";

  before(async () => {
    if (!process.env.BOOK8_CORE_API_KEY) process.env.BOOK8_CORE_API_KEY = API_KEY;
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL;
    await Business.findOneAndUpdate(
      { id: TEST_ID },
      {
        $set: {
          id: TEST_ID,
          name: "Monthly Recap Pref Test",
          timezone: "America/Toronto",
          plan: "starter",
          email: "monthly-pref-test@book8.test",
          trial: { status: "active" }
        }
      },
      { upsert: true }
    );
  });

  it("returns 400 when monthlyRecapEmail is not boolean", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${TEST_ID}/notification-preferences`)
      .set("x-book8-api-key", API_KEY)
      .set("x-book8-user-email", "monthly-pref-test@book8.test")
      .send({ monthlyRecapEmail: "no" });
    assert.strictEqual(res.status, 400);
  });

  it("sets monthlyRecapEmail false with API key + owner email", async () => {
    const res = await request(app)
      .patch(`/api/businesses/${TEST_ID}/notification-preferences`)
      .set("x-book8-api-key", API_KEY)
      .set("x-book8-user-email", "monthly-pref-test@book8.test")
      .send({ monthlyRecapEmail: false });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.business?.notifications?.preferences?.monthlyRecapEmail, false);
    await Business.findOneAndUpdate(
      { id: TEST_ID },
      { $set: { "notifications.preferences.monthlyRecapEmail": true } }
    );
  });
});

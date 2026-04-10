import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeTrialStatus,
  isSubscribedBusiness,
  trialDeniedDashboardWrite,
  trialDeniedPublicChannel,
  getTrialBookingBlock,
  buildTrialStatusPayload
} from "../src/utils/trialLifecycle.js";

function datesFromAnchor(anchorMs, trialDays = 14, graceDays = 3) {
  const startedAt = new Date(anchorMs);
  const endsAt = new Date(startedAt);
  endsAt.setDate(endsAt.getDate() + trialDays);
  const graceEndsAt = new Date(endsAt);
  graceEndsAt.setDate(graceEndsAt.getDate() + graceDays);
  return { startedAt, endsAt, graceEndsAt };
}

describe("trialLifecycle (BOO-97A)", () => {
  const anchor = Date.UTC(2026, 0, 1, 12, 0, 0);
  const { startedAt, endsAt, graceEndsAt } = datesFromAnchor(anchor);

  it("computeTrialStatus: active inside trial window", () => {
    const t = endsAt.getTime() - 60_000;
    const b = { trial: { startedAt, endsAt, graceEndsAt, status: "active" } };
    assert.strictEqual(computeTrialStatus(b, t), "active");
  });

  it("computeTrialStatus: grace after trial end", () => {
    const t = endsAt.getTime() + 60_000;
    const b = { trial: { startedAt, endsAt, graceEndsAt, status: "active" } };
    assert.strictEqual(computeTrialStatus(b, t), "grace");
  });

  it("computeTrialStatus: locked after grace", () => {
    const t = graceEndsAt.getTime() + 60_000;
    const b = { trial: { startedAt, endsAt, graceEndsAt, status: "active" } };
    assert.strictEqual(computeTrialStatus(b, t), "locked");
  });

  it("computeTrialStatus: subscribed overrides dates", () => {
    const t = graceEndsAt.getTime() + 86400_000 * 30;
    const b = {
      trial: { startedAt, endsAt, graceEndsAt, status: "subscribed" },
      subscription: { status: "active" }
    };
    assert.strictEqual(computeTrialStatus(b, t), "subscribed");
  });

  it("isSubscribedBusiness: Stripe + plan", () => {
    assert.strictEqual(
      isSubscribedBusiness({ stripeSubscriptionId: "sub_x", plan: "growth" }),
      true
    );
    assert.strictEqual(isSubscribedBusiness({ stripeSubscriptionId: "sub_x", plan: "none" }), false);
  });

  it("trialDeniedDashboardWrite: blocks in grace", () => {
    const now = Date.now();
    const ends = new Date(now - 86400_000);
    const grace = new Date(now + 86400_000);
    const started = new Date(now - 20 * 86400_000);
    const biz = { id: "b1", trial: { startedAt: started, endsAt: ends, graceEndsAt: grace, status: "active" } };
    const d = trialDeniedDashboardWrite(biz, now);
    assert.ok(d);
    assert.strictEqual(d.body.error, "trial_grace_period");
  });

  it("trialDeniedPublicChannel: null in grace, blocks when locked", () => {
    const now = Date.now();
    const ends = new Date(now - 86400_000);
    const grace = new Date(now + 86400_000);
    const started = new Date(now - 20 * 86400_000);
    const bizGrace = { id: "b1", trial: { startedAt: started, endsAt: ends, graceEndsAt: grace, status: "active" } };
    assert.strictEqual(trialDeniedPublicChannel(bizGrace, now), null);

    const ends2 = new Date(now - 10 * 86400_000);
    const grace2 = new Date(now - 3 * 86400_000);
    const started2 = new Date(now - 30 * 86400_000);
    const bizLocked = {
      id: "b1",
      trial: { startedAt: started2, endsAt: ends2, graceEndsAt: grace2, status: "active" }
    };
    assert.ok(trialDeniedPublicChannel(bizLocked, now));
  });

  it("getTrialBookingBlock: grace allows voice, blocks web", () => {
    const now = Date.now();
    const ends = new Date(now - 86400_000);
    const grace = new Date(now + 86400_000);
    const started = new Date(now - 20 * 86400_000);
    const biz = { id: "b1", trial: { startedAt: started, endsAt: ends, graceEndsAt: grace, status: "active" } };
    assert.strictEqual(getTrialBookingBlock(biz, { source: "voice-agent" }, now), null);
    assert.ok(getTrialBookingBlock(biz, { source: "web" }, now));
  });

  it("buildTrialStatusPayload includes ISO dates", () => {
    const b = { id: "x", trial: { startedAt, endsAt, graceEndsAt, status: "active" } };
    const p = buildTrialStatusPayload(b);
    assert.strictEqual(typeof p.trialEndsAt, "string");
    assert.ok("upgradeUrl" in p);
  });
});

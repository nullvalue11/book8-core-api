/**
 * BOO-45A unit tests (no Stripe / DB).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  clampWindowHours,
  computeFeeAmountMajor,
  feeAppliesForSlot,
  isNoShowProtectionPlanOk
} from "../services/noShowProtection.js";

describe("noShowProtection helpers", () => {
  it("clampWindowHours", () => {
    assert.strictEqual(clampWindowHours(24), 24);
    assert.strictEqual(clampWindowHours(0), 1);
    assert.strictEqual(clampWindowHours(100), 72);
  });

  it("computeFeeAmountMajor fixed vs percentage", () => {
    const b = {
      plan: "growth",
      noShowProtection: { enabled: true, feeType: "fixed", feeAmount: 25 }
    };
    assert.strictEqual(computeFeeAmountMajor(b, 100), 25);
    const b2 = {
      plan: "growth",
      noShowProtection: { enabled: true, feeType: "percentage", feeAmount: 10 }
    };
    assert.strictEqual(computeFeeAmountMajor(b2, 80), 8);
  });

  it("isNoShowProtectionPlanOk starter vs growth", () => {
    assert.strictEqual(isNoShowProtectionPlanOk({ plan: "starter" }), false);
    assert.strictEqual(isNoShowProtectionPlanOk({ plan: "growth" }), true);
  });

  it("feeAppliesForSlot respects window", () => {
    const biz = {
      plan: "growth",
      noShowProtection: {
        enabled: true,
        feeType: "fixed",
        feeAmount: 10,
        cancellationWindowHours: 24
      }
    };
    const soon = new Date(Date.now() + 2 * 3600000).toISOString();
    assert.strictEqual(feeAppliesForSlot(biz, soon), true);
    const later = new Date(Date.now() + 48 * 3600000).toISOString();
    assert.strictEqual(feeAppliesForSlot(biz, later), false);
  });
});

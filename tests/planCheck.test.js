/**
 * QA-002: required plan per feature in 403 responses.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { requiredPlanForFeature, FEATURE_PLAN_MAP } from "../src/middleware/planCheck.js";

describe("planCheck requiredPlan (QA-002)", () => {
  it("maps enterprise-only features", () => {
    assert.strictEqual(requiredPlanForFeature("apiAccess"), "enterprise");
    assert.strictEqual(requiredPlanForFeature("whiteLabel"), "enterprise");
    assert.strictEqual(requiredPlanForFeature("customVoice"), "enterprise");
  });

  it("maps growth-tier features", () => {
    assert.strictEqual(requiredPlanForFeature("multilingual"), "growth");
    assert.strictEqual(requiredPlanForFeature("outlookCalendar"), "growth");
  });

  it("defaults unknown feature to growth", () => {
    assert.strictEqual(requiredPlanForFeature("unknownFeature"), "growth");
  });

  it("FEATURE_PLAN_MAP covers documented keys", () => {
    assert.strictEqual(FEATURE_PLAN_MAP.smsConfirmations, "growth");
  });
});

/**
 * BOO-PHASE4B-2A — provision on trial→paid conversion
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { shouldProvisionNumberOnPaidConversion } from "../services/provisionBusinessNumber.js";

describe("shouldProvisionNumberOnPaidConversion", () => {
  const base = {
    previousSubscriptionStatus: "trialing",
    newSubscriptionStatus: "active",
    business: { assignedTwilioNumber: null },
    stripeEventType: "customer.subscription.updated"
  };

  it("provisions on trialing → active with subscription.updated", () => {
    assert.strictEqual(shouldProvisionNumberOnPaidConversion(base), true);
  });

  it("rejects bare active without previous trialing (renewals / unrelated updates)", () => {
    assert.strictEqual(
      shouldProvisionNumberOnPaidConversion({
        ...base,
        previousSubscriptionStatus: "active"
      }),
      false
    );
    assert.strictEqual(
      shouldProvisionNumberOnPaidConversion({
        ...base,
        previousSubscriptionStatus: null
      }),
      false
    );
  });

  it("rejects trialing → active on wrong event type", () => {
    assert.strictEqual(
      shouldProvisionNumberOnPaidConversion({
        ...base,
        stripeEventType: "invoice.paid"
      }),
      false
    );
  });

  it("allows trialing → active when stripeEventType omitted (legacy callers)", () => {
    assert.strictEqual(
      shouldProvisionNumberOnPaidConversion({
        ...base,
        stripeEventType: null
      }),
      true
    );
  });

  it("skips when business already has dedicated number (Diamond idempotency)", () => {
    assert.strictEqual(
      shouldProvisionNumberOnPaidConversion({
        ...base,
        business: { assignedTwilioNumber: "+14318163850" }
      }),
      false
    );
  });

  it("does not provision on trialing status alone", () => {
    assert.strictEqual(
      shouldProvisionNumberOnPaidConversion({
        ...base,
        newSubscriptionStatus: "trialing"
      }),
      false
    );
  });
});

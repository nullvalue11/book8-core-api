/**
 * BOO-44A: verifyPaidSubscriptionSync + POST /internal/subscription-sync
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import {
  PAID_LIKE,
  verifyPaidSubscriptionSync
} from "../services/stripeSubscriptionVerify.js";

const TEST_BUSINESS_ID = "test-internal-subscription-sync";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

function internalAuth(req) {
  req.set("x-book8-internal-secret", INTERNAL_SECRET);
  return req;
}

function stripeErr404() {
  const e = new Error("No such subscription: sub_bad");
  e.type = "StripeInvalidRequestError";
  e.code = "resource_missing";
  return e;
}

describe("verifyPaidSubscriptionSync", () => {
  it("returns skipStripe for non-paid-like status", async () => {
    const r = await verifyPaidSubscriptionSync({
      stripe: null,
      claimedStatusLower: "canceled",
      stripeSubscriptionId: null,
      storedStripeCustomerId: null
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.skipStripe, true);
  });

  it("requires stripeSubscriptionId for paid-like status", async () => {
    const r = await verifyPaidSubscriptionSync({
      stripe: { subscriptions: { retrieve: async () => ({}) } },
      claimedStatusLower: "active",
      stripeSubscriptionId: "",
      storedStripeCustomerId: null
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "stripe_subscription_id_required");
    assert.strictEqual(r.status, 400);
  });

  it("rejects id without sub_ prefix", async () => {
    const r = await verifyPaidSubscriptionSync({
      stripe: { subscriptions: { retrieve: async () => ({}) } },
      claimedStatusLower: "trialing",
      stripeSubscriptionId: "not_sub_123",
      storedStripeCustomerId: null
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "invalid_stripe_subscription_id");
  });

  it("returns 503 when Stripe client is missing", async () => {
    const r = await verifyPaidSubscriptionSync({
      stripe: null,
      claimedStatusLower: "past_due",
      stripeSubscriptionId: "sub_123",
      storedStripeCustomerId: null
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "stripe_not_configured");
    assert.strictEqual(r.status, 503);
  });

  it("maps Stripe missing subscription to stripe_subscription_not_found", async () => {
    const stripe = {
      subscriptions: {
        retrieve: async () => {
          throw stripeErr404();
        }
      }
    };
    const r = await verifyPaidSubscriptionSync({
      stripe,
      claimedStatusLower: "active",
      stripeSubscriptionId: "sub_missing",
      storedStripeCustomerId: null
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "stripe_subscription_not_found");
  });

  it("rejects when Stripe subscription status is not paid-like", async () => {
    const stripe = {
      subscriptions: {
        retrieve: async () => ({
          id: "sub_x",
          status: "canceled",
          customer: "cus_a"
        })
      }
    };
    const r = await verifyPaidSubscriptionSync({
      stripe,
      claimedStatusLower: "active",
      stripeSubscriptionId: "sub_x",
      storedStripeCustomerId: null
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "stripe_status_mismatch");
  });

  it("rejects when stored stripeCustomerId does not match subscription customer", async () => {
    const stripe = {
      subscriptions: {
        retrieve: async () => ({
          id: "sub_x",
          status: "active",
          customer: "cus_stripe"
        })
      }
    };
    const r = await verifyPaidSubscriptionSync({
      stripe,
      claimedStatusLower: "active",
      stripeSubscriptionId: "sub_x",
      storedStripeCustomerId: "cus_other"
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "stripe_customer_mismatch");
  });

  it("succeeds when Stripe subscription is paid-like and customer matches or is unset", async () => {
    const stripe = {
      subscriptions: {
        retrieve: async () => ({
          id: "sub_ok",
          status: "active",
          customer: "cus_ok"
        })
      }
    };
    const a = await verifyPaidSubscriptionSync({
      stripe,
      claimedStatusLower: "active",
      stripeSubscriptionId: "sub_ok",
      storedStripeCustomerId: "cus_ok"
    });
    assert.strictEqual(a.ok, true);
    assert.ok(a.stripeSubscription);
    assert.strictEqual(a.stripeCustomerId, "cus_ok");

    const b = await verifyPaidSubscriptionSync({
      stripe,
      claimedStatusLower: "active",
      stripeSubscriptionId: "sub_ok",
      storedStripeCustomerId: null
    });
    assert.strictEqual(b.ok, true);
  });

  it("reads customer id from expanded customer object", async () => {
    const stripe = {
      subscriptions: {
        retrieve: async () => ({
          id: "sub_ok",
          status: "trialing",
          customer: { id: "cus_expanded" }
        })
      }
    };
    const r = await verifyPaidSubscriptionSync({
      stripe,
      claimedStatusLower: "trialing",
      stripeSubscriptionId: "sub_ok",
      storedStripeCustomerId: "cus_expanded"
    });
    assert.strictEqual(r.ok, true);
  });
});

describe("POST /internal/subscription-sync", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_BUSINESS_ID },
      {
        $set: {
          id: TEST_BUSINESS_ID,
          name: "Subscription Sync Test",
          timezone: "America/Toronto",
          plan: "growth"
        },
        $unset: { stripeCustomerId: "", stripeSubscriptionId: "" }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Business.deleteOne({ id: TEST_BUSINESS_ID });
  });

  it("returns 400 when paid-like status omits stripeSubscriptionId", async () => {
    const res = await internalAuth(
      request(app)
        .post("/internal/subscription-sync")
        .send({
          businessId: TEST_BUSINESS_ID,
          subscriptionStatus: "active"
        })
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.error, "stripe_subscription_id_required");
  });

  it("returns 400 when stripeSubscriptionId has wrong prefix", async () => {
    const res = await internalAuth(
      request(app)
        .post("/internal/subscription-sync")
        .send({
          businessId: TEST_BUSINESS_ID,
          subscriptionStatus: "active",
          stripeSubscriptionId: "si_fake"
        })
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "invalid_stripe_subscription_id");
  });

  it("returns 200 for canceled without Stripe verification", async () => {
    const res = await internalAuth(
      request(app)
        .post("/internal/subscription-sync")
        .send({
          businessId: TEST_BUSINESS_ID,
          subscriptionStatus: "canceled"
        })
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const doc = await Business.findOne({ id: TEST_BUSINESS_ID }).lean();
    assert.strictEqual(doc.subscription?.status, "canceled");
  });
});

describe("PAID_LIKE export", () => {
  it("includes active, trialing, past_due", () => {
    assert.ok(PAID_LIKE.has("active"));
    assert.ok(PAID_LIKE.has("trialing"));
    assert.ok(PAID_LIKE.has("past_due"));
  });
});

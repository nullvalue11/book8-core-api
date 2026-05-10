/**
 * BOO-MULTI-CURRENCY-1A — Stripe price IDs + public pricing
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import express from "express";
import request from "supertest";
import plansRouter from "../src/routes/plans.js";
import {
  getPriceIdForPlan,
  getPlansPricingByCurrency,
  resolveSubscriptionPriceForBusiness
} from "../src/config/plans.js";

function pricingApp() {
  const app = express();
  app.use("/api/plans", plansRouter);
  return app;
}

describe("getPriceIdForPlan", () => {
  const backup = {};

  function stash(key) {
    if (!(key in backup)) backup[key] = process.env[key];
  }

  beforeEach(() => {
    [
      "STRIPE_PRICE_STARTER_USD",
      "STRIPE_PRICE_STARTER",
      "STRIPE_PRICE_STARTER_AED",
      "STRIPE_PRICE_GROWTH_USD",
      "STRIPE_PRICE_GROWTH",
      "STRIPE_PRICE_GROWTH_AED",
      "STRIPE_PRICE_ENTERPRISE_USD",
      "STRIPE_PRICE_ENTERPRISE",
      "STRIPE_PRICE_ENTERPRISE_AED"
    ].forEach(stash);

    process.env.STRIPE_PRICE_STARTER_USD = "price_starter_usd";
    process.env.STRIPE_PRICE_STARTER_AED = "price_starter_aed";
    process.env.STRIPE_PRICE_GROWTH_USD = "price_growth_usd";
    process.env.STRIPE_PRICE_GROWTH_AED = "price_growth_aed";
    process.env.STRIPE_PRICE_ENTERPRISE_USD = "price_ent_usd";
    process.env.STRIPE_PRICE_ENTERPRISE_AED = "price_ent_aed";
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(backup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns AED Price ID for starter + aed", () => {
    assert.strictEqual(getPriceIdForPlan("starter", "aed"), "price_starter_aed");
  });

  it("falls back to USD Price ID for unsupported currency (e.g. jpy)", () => {
    assert.strictEqual(getPriceIdForPlan("starter", "jpy"), "price_starter_usd");
  });

  it("resolveSubscriptionPriceForBusiness uses business country", () => {
    const r = resolveSubscriptionPriceForBusiness({ country: "AE" }, "growth");
    assert.strictEqual(r.currency, "aed");
    assert.strictEqual(r.priceId, "price_growth_aed");
  });
});

describe("getPlansPricingByCurrency", () => {
  it("returns USD major amounts", () => {
    const p = getPlansPricingByCurrency("usd");
    assert.strictEqual(p.starter.amount, 19);
    assert.strictEqual(p.starter.displaySymbol, "$");
  });

  it("returns AED major amounts", () => {
    const p = getPlansPricingByCurrency("aed");
    assert.strictEqual(p.enterprise.amount, 730);
    assert.strictEqual(p.enterprise.currency, "aed");
  });
});

describe("GET /api/plans/pricing", () => {
  it("returns AED prices for country=AE", async () => {
    const res = await request(pricingApp()).get("/api/plans/pricing?country=AE");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.starter.currency, "aed");
    assert.strictEqual(res.body.starter.amount, 70);
    assert.strictEqual(res.body.starter.displaySymbol, "AED");
  });

  it("returns USD prices for country=US", async () => {
    const res = await request(pricingApp()).get("/api/plans/pricing?country=US");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.growth.currency, "usd");
    assert.strictEqual(res.body.growth.amount, 79);
    assert.strictEqual(res.body.growth.displaySymbol, "$");
  });

  it("defaults to USD with no country query", async () => {
    const res = await request(pricingApp()).get("/api/plans/pricing");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.starter.currency, "usd");
  });
});

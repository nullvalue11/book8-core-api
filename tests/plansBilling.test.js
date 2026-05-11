/**
 * BOO-MULTI-CURRENCY-1A / BOO-MULTI-CURRENCY-FIX-1A — Stripe price IDs + public pricing
 *
 * Home currency is CAD; USD + AED are additional currencies. Legacy no-suffix
 * STRIPE_PRICE_* env vars hold the CAD Price IDs (production reality).
 * Pricing API amounts are always Stripe minor units (frontend divides by 100).
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

const STRIPE_ENV_KEYS = [
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_STARTER_CAD",
  "STRIPE_PRICE_STARTER_USD",
  "STRIPE_PRICE_STARTER_AED",
  "STRIPE_PRICE_GROWTH",
  "STRIPE_PRICE_GROWTH_CAD",
  "STRIPE_PRICE_GROWTH_USD",
  "STRIPE_PRICE_GROWTH_AED",
  "STRIPE_PRICE_ENTERPRISE",
  "STRIPE_PRICE_ENTERPRISE_CAD",
  "STRIPE_PRICE_ENTERPRISE_USD",
  "STRIPE_PRICE_ENTERPRISE_AED"
];

function snapshotEnv() {
  const snap = {};
  for (const k of STRIPE_ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearEnv() {
  for (const k of STRIPE_ENV_KEYS) delete process.env[k];
}

describe("getPriceIdForPlan", () => {
  let backup;

  beforeEach(() => {
    backup = snapshotEnv();
    clearEnv();
    process.env.STRIPE_PRICE_STARTER_CAD = "price_starter_cad";
    process.env.STRIPE_PRICE_STARTER_USD = "price_starter_usd";
    process.env.STRIPE_PRICE_STARTER_AED = "price_starter_aed";
    process.env.STRIPE_PRICE_GROWTH_CAD = "price_growth_cad";
    process.env.STRIPE_PRICE_GROWTH_USD = "price_growth_usd";
    process.env.STRIPE_PRICE_GROWTH_AED = "price_growth_aed";
    process.env.STRIPE_PRICE_ENTERPRISE_CAD = "price_ent_cad";
    process.env.STRIPE_PRICE_ENTERPRISE_USD = "price_ent_usd";
    process.env.STRIPE_PRICE_ENTERPRISE_AED = "price_ent_aed";
  });

  afterEach(() => {
    restoreEnv(backup);
  });

  it("returns CAD Price ID for starter + cad", () => {
    assert.strictEqual(getPriceIdForPlan("starter", "cad"), "price_starter_cad");
  });

  it("returns USD Price ID for starter + usd", () => {
    assert.strictEqual(getPriceIdForPlan("starter", "usd"), "price_starter_usd");
  });

  it("returns AED Price ID for starter + aed", () => {
    assert.strictEqual(getPriceIdForPlan("starter", "aed"), "price_starter_aed");
  });

  it("falls back to CAD Price ID for unsupported currency (e.g. jpy)", () => {
    assert.strictEqual(getPriceIdForPlan("starter", "jpy"), "price_starter_cad");
  });

  it("resolveSubscriptionPriceForBusiness uses business country (AE → aed)", () => {
    const r = resolveSubscriptionPriceForBusiness({ country: "AE" }, "growth");
    assert.strictEqual(r.currency, "aed");
    assert.strictEqual(r.priceId, "price_growth_aed");
  });

  it("resolveSubscriptionPriceForBusiness uses business country (CA → cad)", () => {
    const r = resolveSubscriptionPriceForBusiness({ country: "CA" }, "growth");
    assert.strictEqual(r.currency, "cad");
    assert.strictEqual(r.priceId, "price_growth_cad");
  });

  it("resolveSubscriptionPriceForBusiness uses business country (US → usd)", () => {
    const r = resolveSubscriptionPriceForBusiness({ country: "US" }, "enterprise");
    assert.strictEqual(r.currency, "usd");
    assert.strictEqual(r.priceId, "price_ent_usd");
  });
});

describe("getPriceIdForPlan legacy no-suffix env var fallback", () => {
  let backup;

  beforeEach(() => {
    backup = snapshotEnv();
    clearEnv();
    // Production reality: legacy no-suffix env vars hold the CAD Price IDs.
    process.env.STRIPE_PRICE_STARTER = "price_legacy_starter_cad";
    process.env.STRIPE_PRICE_GROWTH = "price_legacy_growth_cad";
    process.env.STRIPE_PRICE_ENTERPRISE = "price_legacy_enterprise_cad";
  });

  afterEach(() => {
    restoreEnv(backup);
  });

  it("STRIPE_PRICE_STARTER (no suffix) resolves to CAD, not USD", () => {
    assert.strictEqual(getPriceIdForPlan("starter", "cad"), "price_legacy_starter_cad");
  });

  it("CAD-suffixed env wins over no-suffix legacy env", () => {
    process.env.STRIPE_PRICE_STARTER_CAD = "price_explicit_starter_cad";
    assert.strictEqual(getPriceIdForPlan("starter", "cad"), "price_explicit_starter_cad");
  });

  it("unsupported currency falls back to CAD Price ID via legacy env var", () => {
    assert.strictEqual(getPriceIdForPlan("growth", "jpy"), "price_legacy_growth_cad");
  });

  it("USD request with only legacy env falls back to CAD Price ID via defaultCurrency", () => {
    assert.strictEqual(getPriceIdForPlan("enterprise", "usd"), "price_legacy_enterprise_cad");
  });
});

describe("getPlansPricingByCurrency", () => {
  it("returns CAD minor amounts (home currency)", () => {
    const p = getPlansPricingByCurrency("cad");
    assert.strictEqual(p.starter.amount, 2900);
    assert.strictEqual(p.growth.amount, 9900);
    assert.strictEqual(p.enterprise.amount, 29900);
    assert.strictEqual(p.starter.currency, "cad");
    assert.strictEqual(p.starter.displaySymbol, "CA$");
  });

  it("returns USD minor amounts (US list)", () => {
    const p = getPlansPricingByCurrency("usd");
    assert.strictEqual(p.starter.amount, 1900);
    assert.strictEqual(p.growth.amount, 6900);
    assert.strictEqual(p.enterprise.amount, 19900);
    assert.strictEqual(p.starter.displaySymbol, "$");
  });

  it("returns AED minor amounts", () => {
    const p = getPlansPricingByCurrency("aed");
    assert.strictEqual(p.starter.amount, 7000);
    assert.strictEqual(p.growth.amount, 25000);
    assert.strictEqual(p.enterprise.amount, 73000);
    assert.strictEqual(p.enterprise.currency, "aed");
  });
});

describe("GET /api/plans/pricing", () => {
  it("returns CAD minor units for country=CA", async () => {
    const res = await request(pricingApp()).get("/api/plans/pricing?country=CA");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.starter.currency, "cad");
    assert.strictEqual(res.body.starter.amount, 2900);
    assert.strictEqual(res.body.starter.displaySymbol, "CA$");
    assert.strictEqual(res.body.growth.amount, 9900);
    assert.strictEqual(res.body.enterprise.amount, 29900);
    assert.deepStrictEqual(res.body.channels, { voice: true, whatsapp: true, sms: true });
  });

  it("returns AED minor units for country=AE", async () => {
    const res = await request(pricingApp()).get("/api/plans/pricing?country=AE");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      starter: { amount: 7000, currency: "aed", displaySymbol: "AED" },
      growth: { amount: 25000, currency: "aed", displaySymbol: "AED" },
      enterprise: { amount: 73000, currency: "aed", displaySymbol: "AED" },
      channels: { voice: false, whatsapp: true, sms: false }
    });
  });

  it("returns USD minor units for country=US", async () => {
    const res = await request(pricingApp()).get("/api/plans/pricing?country=US");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.starter.amount, 1900);
    assert.strictEqual(res.body.growth.amount, 6900);
    assert.strictEqual(res.body.enterprise.amount, 19900);
    assert.strictEqual(res.body.growth.currency, "usd");
    assert.strictEqual(res.body.growth.displaySymbol, "$");
    assert.deepStrictEqual(res.body.channels, { voice: true, whatsapp: true, sms: true });
  });

  it("defaults to USD minor units with no country query", async () => {
    const res = await request(pricingApp()).get("/api/plans/pricing");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.starter.currency, "usd");
    assert.strictEqual(res.body.starter.amount, 1900);
    assert.deepStrictEqual(res.body.channels, { voice: true, whatsapp: true, sms: false });
  });
});

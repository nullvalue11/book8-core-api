#!/usr/bin/env node
/**
 * BOO-MULTI-CURRENCY-FIX-1A — create CAD + USD recurring Prices on existing Products.
 *
 * Usage:
 *   node scripts/createStripeMultiCurrencyPrices.mjs              # dry-run (default)
 *   node scripts/createStripeMultiCurrencyPrices.mjs --apply      # create in Stripe
 *
 * Discovers Product IDs from existing STRIPE_PRICE_* env vars (no-suffix = current CAD).
 * Outputs Render env vars for STRIPE_PRICE_*_CAD / STRIPE_PRICE_*_USD.
 *
 * Legacy pre-fix USD prices ($29/$99/$299 USD) are NOT modified — set manually:
 *   STRIPE_PRICE_LEGACY_STARTER_USD, STRIPE_PRICE_LEGACY_GROWTH_USD, STRIPE_PRICE_LEGACY_ENTERPRISE_USD
 */
import "dotenv/config";
import Stripe from "stripe";

const APPLY = process.argv.includes("--apply");

const TIERS = [
  {
    plan: "starter",
    cadEnv: "STRIPE_PRICE_STARTER_CAD",
    usdEnv: "STRIPE_PRICE_STARTER_USD",
    legacyCadEnv: "STRIPE_PRICE_STARTER",
    amounts: { cad: 2900, usd: 1900 }
  },
  {
    plan: "growth",
    cadEnv: "STRIPE_PRICE_GROWTH_CAD",
    usdEnv: "STRIPE_PRICE_GROWTH_USD",
    legacyCadEnv: "STRIPE_PRICE_GROWTH",
    amounts: { cad: 9900, usd: 6900 }
  },
  {
    plan: "enterprise",
    cadEnv: "STRIPE_PRICE_ENTERPRISE_CAD",
    usdEnv: "STRIPE_PRICE_ENTERPRISE_USD",
    legacyCadEnv: "STRIPE_PRICE_ENTERPRISE",
    amounts: { cad: 29900, usd: 19900 }
  }
];

function env(key) {
  const v = process.env[key];
  return v != null && String(v).trim() ? String(v).trim() : "";
}

async function productIdForTier(stripe, tier) {
  const existingId =
    env(tier.cadEnv) || env(tier.legacyCadEnv) || env(tier.usdEnv);
  if (!existingId) {
    throw new Error(
      `No existing price env for ${tier.plan} — set ${tier.legacyCadEnv} or ${tier.cadEnv}`
    );
  }
  const price = await stripe.prices.retrieve(existingId);
  const product = price.product;
  return typeof product === "string" ? product : product?.id;
}

async function findExistingPrice(stripe, productId, currency, unitAmount) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return prices.data.find(
    (p) =>
      p.currency === currency &&
      p.unit_amount === unitAmount &&
      p.recurring?.interval === "month"
  );
}

async function ensurePrice(stripe, { productId, currency, unitAmount, plan, nickname }) {
  const existing = await findExistingPrice(stripe, productId, currency, unitAmount);
  if (existing) {
    return { created: false, price: existing };
  }
  if (!APPLY) {
    return {
      created: false,
      price: {
        id: `(dry-run) price_${plan}_${currency}`,
        currency,
        unit_amount: unitAmount,
        product: productId
      },
      dryRunWouldCreate: true
    };
  }
  const price = await stripe.prices.create({
    product: productId,
    currency,
    unit_amount: unitAmount,
    recurring: { interval: "month" },
    nickname,
    metadata: { plan, book8_currency: currency }
  });
  return { created: true, price };
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is required.");
    process.exit(1);
  }

  const stripe = new Stripe(key);
  const report = { mode: APPLY ? "apply" : "dry-run", env: {}, notes: [] };

  console.log(`[createStripeMultiCurrencyPrices] mode=${report.mode}`);

  for (const tier of TIERS) {
    const productId = await productIdForTier(stripe, tier);
    console.log(`\n${tier.plan}: product=${productId}`);

    for (const currency of ["cad", "usd"]) {
      const amount = tier.amounts[currency];
      const envKey = currency === "cad" ? tier.cadEnv : tier.usdEnv;
      const configured = env(envKey) || (currency === "cad" ? env(tier.legacyCadEnv) : "");

      if (configured) {
        const p = await stripe.prices.retrieve(configured);
        const ok =
          p.currency === currency &&
          p.unit_amount === amount &&
          p.recurring?.interval === "month";
        report.env[envKey] = configured;
        console.log(
          `  ${envKey}=${configured} (${p.currency} ${p.unit_amount}) ${ok ? "ok" : "MISMATCH"}`
        );
        if (!ok) {
          report.notes.push(`${envKey} points to wrong amount/currency — review in Stripe`);
        }
        continue;
      }

      const { created, price, dryRunWouldCreate } = await ensurePrice(stripe, {
        productId,
        currency,
        unitAmount: amount,
        plan: tier.plan,
        nickname: `Book8 ${tier.plan} (${currency.toUpperCase()})`
      });

      report.env[envKey] = price.id;
      if (dryRunWouldCreate) {
        console.log(`  would create ${currency} ${amount} → set ${envKey} after --apply`);
      } else if (created) {
        console.log(`  created ${price.id} (${currency} ${amount})`);
      } else {
        console.log(`  reusing ${price.id} (${currency} ${amount})`);
      }
    }
  }

  console.log("\n--- Render env (copy after verifying) ---");
  for (const [k, v] of Object.entries(report.env)) {
    console.log(`${k}=${v}`);
  }

  console.log("\n--- Legacy USD webhook IDs (do not use for new checkout) ---");
  console.log("STRIPE_PRICE_LEGACY_STARTER_USD=<old $29 USD price id>");
  console.log("STRIPE_PRICE_LEGACY_GROWTH_USD=<old $99 USD price id>");
  console.log("STRIPE_PRICE_LEGACY_ENTERPRISE_USD=<old $299 USD price id>");

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to create missing prices.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

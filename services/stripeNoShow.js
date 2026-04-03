/**
 * BOO-45A: Stripe SetupIntent + off-session charges for no-show / cancellation fees.
 */

import Stripe from "stripe";
import {
  computeFeeAmountMajor,
  majorToStripeCents,
  resolveCurrency
} from "./noShowProtection.js";

let _stripe = null;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!_stripe) {
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export async function findOrCreateStripeCustomer({ email, name, phone, businessId }) {
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, error: "Stripe is not configured" };
  }
  const em = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!em) {
    return { ok: false, error: "customerEmail is required" };
  }

  try {
    const list = await stripe.customers.list({ email: em, limit: 1 });
    if (list.data.length > 0) {
      return { ok: true, customerId: list.data[0].id };
    }
  } catch (e) {
    console.warn("[stripeNoShow] customer list failed, creating new:", e.message);
  }

  try {
    const customer = await stripe.customers.create({
      email: em,
      name: typeof name === "string" ? name.slice(0, 200) : undefined,
      phone: typeof phone === "string" ? phone.slice(0, 32) : undefined,
      metadata: { book8BusinessId: String(businessId || "").slice(0, 80) }
    });
    return { ok: true, customerId: customer.id };
  } catch (err) {
    console.error("[stripeNoShow] customers.create:", err.message);
    return { ok: false, error: err.message || "Failed to create Stripe customer" };
  }
}

export async function createCardSetupIntent({ stripeCustomerId, businessId }) {
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, error: "Stripe is not configured" };
  }
  if (!stripeCustomerId) {
    return { ok: false, error: "stripeCustomerId is required" };
  }
  try {
    const si = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: { book8BusinessId: String(businessId || "").slice(0, 80) }
    });
    return { ok: true, clientSecret: si.client_secret, setupIntentId: si.id };
  } catch (err) {
    console.error("[stripeNoShow] setupIntent:", err.message);
    return { ok: false, error: err.message || "SetupIntent failed" };
  }
}

/**
 * Charge saved card (no-show or cancellation fee).
 * @returns {{ ok: true, paymentIntentId: string, amountCents: number, amountMajor: number } | { ok: false, error: string }}
 */
export async function chargeSavedPaymentMethod({
  booking,
  business,
  serviceName,
  description,
  metadata
}) {
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, error: "Stripe is not configured" };
  }
  if (!booking?.stripeCustomerId || !booking?.stripePaymentMethodId) {
    return { ok: false, error: "Booking has no saved card" };
  }

  const currency = resolveCurrency(business);
  const servicePrice =
    metadata?.servicePriceMajor != null ? Number(metadata.servicePriceMajor) : null;
  const amountMajor = computeFeeAmountMajor(business, servicePrice);
  if (!(amountMajor > 0)) {
    return { ok: false, error: "Fee amount is zero or invalid" };
  }
  const amountCents = majorToStripeCents(amountMajor, currency);
  if (!(amountCents > 0)) {
    return { ok: false, error: "Fee amount rounds to zero" };
  }

  const bizName = business?.name || booking.businessId;
  const desc =
    description ||
    `Fee for ${serviceName || booking.serviceId || "appointment"} at ${bizName}`;

  try {
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      customer: booking.stripeCustomerId,
      payment_method: booking.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      description: desc.slice(0, 500),
      metadata: {
        book8BookingId: String(booking.id || "").slice(0, 80),
        book8BusinessId: String(booking.businessId || "").slice(0, 80),
        ...metadata
      }
    });

    if (pi.status !== "succeeded") {
      return { ok: false, error: `Payment not succeeded (${pi.status})` };
    }

    return {
      ok: true,
      paymentIntentId: pi.id,
      amountCents,
      amountMajor
    };
  } catch (err) {
    console.error("[stripeNoShow] paymentIntents.create:", err.message);
    return { ok: false, error: err.message || "Charge failed" };
  }
}

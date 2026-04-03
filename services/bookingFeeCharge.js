/**
 * BOO-45A: Stripe charges for cancellation / no-show tied to booking + business settings.
 */

import { feeAppliesForSlot } from "./noShowProtection.js";
import { chargeSavedPaymentMethod } from "./stripeNoShow.js";

export async function tryChargeCancellationFee(booking, business, service) {
  if (!booking || booking.status !== "confirmed") {
    return { ok: true, charged: false };
  }
  if (!business?.noShowProtection?.enabled) {
    return { ok: true, charged: false };
  }
  if (!feeAppliesForSlot(business, booking.slot?.start)) {
    return { ok: true, charged: false };
  }
  if (!booking.stripePaymentMethodId || !booking.stripeCustomerId) {
    return { ok: true, charged: false, skipped: "no_card" };
  }
  if (booking.cancellationFeeCharged) {
    return { ok: true, charged: false };
  }

  const serviceName = service?.name || booking.serviceId || "Appointment";
  const price = typeof service?.price === "number" && Number.isFinite(service.price) ? service.price : null;

  const r = await chargeSavedPaymentMethod({
    booking,
    business,
    serviceName,
    description: `Cancellation fee for ${serviceName} at ${business.name || booking.businessId}`,
    metadata: {
      kind: "cancellation_fee",
      servicePriceMajor: price != null ? String(price) : ""
    }
  });

  if (!r.ok) {
    return { ok: false, charged: false, error: r.error };
  }

  return {
    ok: true,
    charged: true,
    paymentIntentId: r.paymentIntentId,
    amountMajor: r.amountMajor
  };
}

export async function tryChargeNoShowFee(booking, business, service) {
  if (!booking?.stripePaymentMethodId || !booking?.stripeCustomerId) {
    return { ok: true, charged: false, skipped: "no_card" };
  }
  if (booking.noShowCharged) {
    return { ok: true, charged: false };
  }

  const serviceName = service?.name || booking.serviceId || "Appointment";
  const price = typeof service?.price === "number" && Number.isFinite(service.price) ? service.price : null;

  const r = await chargeSavedPaymentMethod({
    booking,
    business,
    serviceName,
    description: `No-show fee for ${serviceName} at ${business.name || booking.businessId}`,
    metadata: {
      kind: "no_show_fee",
      servicePriceMajor: price != null ? String(price) : ""
    }
  });

  if (!r.ok) {
    return { ok: false, charged: false, error: r.error };
  }

  return {
    ok: true,
    charged: true,
    paymentIntentId: r.paymentIntentId,
    amountMajor: r.amountMajor
  };
}

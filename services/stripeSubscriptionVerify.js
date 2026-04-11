/**
 * BOO-44A: Verify paid-like subscription sync against live Stripe before mutating trial / DB.
 */
export const PAID_LIKE = new Set(["active", "trialing", "past_due"]);

/**
 * @param {object} params
 * @param {import("stripe").default | null} params.stripe - from getStripe(); null if STRIPE_SECRET_KEY unset
 * @param {string} params.claimedStatusLower - normalized subscriptionStatus from caller
 * @param {unknown} params.stripeSubscriptionId - body field
 * @param {unknown} params.storedStripeCustomerId - business root stripeCustomerId (if any)
 * @returns {Promise<
 *   | { ok: true; skipStripe: true }
 *   | { ok: true; stripeSubscription: import("stripe").Stripe.Subscription; stripeCustomerId?: string }
 *   | { ok: false; code: string; status: number; message: string }
 * >}
 */
export async function verifyPaidSubscriptionSync({
  stripe,
  claimedStatusLower,
  stripeSubscriptionId,
  storedStripeCustomerId
}) {
  if (!PAID_LIKE.has(claimedStatusLower)) {
    return { ok: true, skipStripe: true };
  }

  const sid =
    typeof stripeSubscriptionId === "string" ? stripeSubscriptionId.trim() : "";
  if (!sid) {
    return {
      ok: false,
      code: "stripe_subscription_id_required",
      status: 400,
      message:
        "stripeSubscriptionId is required for active, trialing, or past_due subscription status"
    };
  }
  if (!sid.startsWith("sub_")) {
    return {
      ok: false,
      code: "invalid_stripe_subscription_id",
      status: 400,
      message: "stripeSubscriptionId must be a Stripe subscription id (prefix sub_)"
    };
  }
  if (!stripe) {
    return {
      ok: false,
      code: "stripe_not_configured",
      status: 503,
      message: "STRIPE_SECRET_KEY is required to verify paid subscription state"
    };
  }

  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(sid);
  } catch (err) {
    console.warn(
      "[subscription-sync] Stripe subscriptions.retrieve failed:",
      err?.message || err
    );
    const missing =
      err?.code === "resource_missing" ||
      err?.type === "StripeInvalidRequestError" ||
      (typeof err?.message === "string" && /no such subscription/i.test(err.message));
    return {
      ok: false,
      code: "stripe_subscription_not_found",
      status: 400,
      message: missing
        ? "Stripe subscription not found"
        : "Could not verify subscription with Stripe"
    };
  }

  const stripeStatus =
    typeof sub.status === "string" ? sub.status.trim().toLowerCase() : "";
  if (!PAID_LIKE.has(stripeStatus)) {
    return {
      ok: false,
      code: "stripe_status_mismatch",
      status: 400,
      message: `Stripe subscription status is ${stripeStatus || "unknown"}, not a paid state`
    };
  }

  let custId =
    typeof sub.customer === "string"
      ? sub.customer
      : sub.customer && typeof sub.customer === "object" && sub.customer.id
        ? sub.customer.id
        : null;
  const stored =
    typeof storedStripeCustomerId === "string"
      ? storedStripeCustomerId.trim()
      : "";
  if (stored && custId && stored !== custId) {
    return {
      ok: false,
      code: "stripe_customer_mismatch",
      status: 400,
      message: "Subscription customer does not match business stripeCustomerId"
    };
  }

  console.log(
    `[subscription-sync] Stripe verified sub=${sid} stripeStatus=${stripeStatus} customer=${custId || "n/a"}`
  );
  return { ok: true, stripeSubscription: sub, stripeCustomerId: custId || undefined };
}

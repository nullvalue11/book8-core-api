/**
 * BOO-PHASE4B-2A — Provision a dedicated Twilio number when a business converts to paid.
 * Wraps pool assignment + webhook/ElevenLabs setup; idempotent when a number already exists.
 */
import { Business } from "../models/Business.js";
import {
  assignTwilioNumberFromPool,
  businessLookupFilter,
  canonicalBusinessId
} from "./provisioningHelpers.js";
import { maskPhone } from "../src/utils/maskPhone.js";
import { writeAuditLog } from "../src/utils/auditLog.js";

/**
 * Trial→paid conversion guard (customer.subscription.updated + previous_attributes.status).
 * Do NOT use bare status === "active" — that fires on renewals and unrelated updates.
 *
 * @param {object} params
 * @param {string|null|undefined} params.previousSubscriptionStatus — Stripe previous_attributes.status
 * @param {string} params.newSubscriptionStatus — normalized lowercase subscription.status
 * @param {object|null|undefined} params.business
 * @param {string|null|undefined} params.stripeEventType — e.g. customer.subscription.updated
 */
export function shouldProvisionNumberOnPaidConversion({
  previousSubscriptionStatus,
  newSubscriptionStatus,
  business,
  stripeEventType
}) {
  if (stripeEventType && stripeEventType !== "customer.subscription.updated") return false;
  if (newSubscriptionStatus !== "active") return false;
  if (previousSubscriptionStatus !== "trialing") return false;
  if (business?.assignedTwilioNumber) return false;
  return true;
}

/**
 * @param {string} businessId
 * @returns {Promise<{ ok: boolean, skipped?: boolean, phone?: string, detail?: string, retryable?: boolean }>}
 */
export async function provisionBusinessNumber(businessId) {
  const business = await Business.findOne(businessLookupFilter(businessId)).lean();
  if (!business) {
    return { ok: false, detail: "Business not found", retryable: false };
  }

  const bid = canonicalBusinessId(business);
  if (!bid) {
    return { ok: false, detail: "Business has no id/businessId", retryable: false };
  }

  if (business.assignedTwilioNumber) {
    return {
      ok: true,
      skipped: true,
      phone: business.assignedTwilioNumber,
      detail: "Dedicated number already assigned"
    };
  }

  const result = await assignTwilioNumberFromPool(bid);

  if (result.skipped) {
    return { ok: true, skipped: true, detail: result.detail, plan: result.plan };
  }

  if (result.ok && result.phone) {
    await Business.findOneAndUpdate(businessLookupFilter(bid), {
      $set: { twilioNumberStatus: "provisioned" },
      $unset: { "metadata.numberProvisioningPending": "" }
    }).catch(() => {});

    console.log(
      JSON.stringify({
        event: "number_provisioned",
        businessId: bid,
        phone: maskPhone(result.phone),
        webhooksConfigured: result.webhooksConfigured,
        elevenLabsRegistered: result.elevenLabsRegistered
      })
    );

    if (!result.webhooksConfigured || !result.elevenLabsRegistered) {
      console.warn(
        `[provisioning] ${bid}: partial setup — webhooks=${!!result.webhooksConfigured} elevenLabs=${!!result.elevenLabsRegistered}. A2P 10DLC: confirm SMS campaign registration in Twilio if confirmations fail.`
      );
    }

    return result;
  }

  await Business.findOneAndUpdate(businessLookupFilter(bid), {
    $set: {
      twilioNumberStatus: "failed",
      "metadata.numberProvisioningPending": true
    }
  }).catch(() => {});

  const failContext = {
    detail: result.detail || "Unknown provisioning failure",
    retryable: true
  };
  await writeAuditLog({
    event: "number_provisioning_failed",
    businessId: bid,
    context: failContext
  });
  console.log(
    JSON.stringify({
      event: "number_provisioning_failed",
      businessId: bid,
      ...failContext
    })
  );

  return {
    ok: false,
    detail: result.detail,
    retryable: true
  };
}

/**
 * Shared provisioning steps used by internalProvision and provisioning retry.
 */
import { Business } from "../models/Business.js";
import { TwilioNumber } from "../models/TwilioNumber.js";
import {
  configureTwilioWebhooksForNumber,
  registerNumberInElevenLabs,
  logProvisioningNumberSetup
} from "./twilioNumberSetup.js";
import { ensureBookableDefaultsForBusiness } from "./bookableBootstrap.js";

/** Match business by canonical slug stored in `id` or duplicate `businessId`. */
export function businessLookupFilter(slugOrId) {
  return { $or: [{ id: slugOrId }, { businessId: slugOrId }] };
}

export function canonicalBusinessId(business) {
  if (!business) return null;
  return business.id || business.businessId || null;
}

/**
 * Assign next available Twilio pool number to business, configure webhooks + ElevenLabs.
 * @param {string} slugOrId - same id used in provision webhook
 * @returns {Promise<{ ok: boolean, skipped?: boolean, phone?: string, detail?: string, webhooksConfigured?: boolean, elevenLabsRegistered?: boolean }>}
 */
export async function assignTwilioNumberFromPool(slugOrId) {
  const business = await Business.findOne(businessLookupFilter(slugOrId)).lean();
  if (!business) {
    return { ok: false, detail: "Business not found" };
  }
  const bid = canonicalBusinessId(business);
  if (!bid) {
    return { ok: false, detail: "Business has no id/businessId" };
  }

  if (business.assignedTwilioNumber) {
    return {
      ok: true,
      skipped: true,
      phone: business.assignedTwilioNumber,
      detail: "Number already assigned"
    };
  }

  const number = await TwilioNumber.findOneAndUpdate(
    { status: "available" },
    {
      status: "assigned",
      assignedToBusinessId: bid,
      assignedAt: new Date(),
      updatedAt: new Date()
    },
    { new: true, sort: { createdAt: 1 } }
  );

  if (!number) {
    await Business.findOneAndUpdate(businessLookupFilter(slugOrId), {
      $set: { numberSetupMethod: "pending" }
    }).catch(() => {});
    return { ok: false, detail: "No available Twilio numbers in pool" };
  }

  await Business.findOneAndUpdate(businessLookupFilter(slugOrId), {
    $set: {
      assignedTwilioNumber: number.phoneNumber,
      numberSetupMethod: "direct"
    }
  });

  const webhooksConfigured = await configureTwilioWebhooksForNumber({
    twilioSid: number.twilioSid,
    phoneNumber: number.phoneNumber
  });
  if (!webhooksConfigured) {
    console.warn("[provisioningHelpers] Twilio webhooks not fully configured for", number.phoneNumber);
  }

  const elevenLabsRegistered = await registerNumberInElevenLabs(number.phoneNumber);
  if (!elevenLabsRegistered) {
    console.warn("[provisioningHelpers] ElevenLabs registration failed or skipped for", number.phoneNumber);
  }

  logProvisioningNumberSetup({
    phoneNumber: number.phoneNumber,
    webhooksConfigured,
    elevenLabsRegistered
  });

  return {
    ok: true,
    phone: number.phoneNumber,
    webhooksConfigured,
    elevenLabsRegistered,
    detail: `Assigned ${number.phoneNumber}`
  };
}

/**
 * Re-run webhook + ElevenLabs for an already-assigned number (retry path).
 */
export async function configureWebhooksAndElevenLabsForBusiness(slugOrId) {
  const business = await Business.findOne(businessLookupFilter(slugOrId)).lean();
  if (!business?.assignedTwilioNumber) {
    return { ok: false, detail: "No assignedTwilioNumber on business" };
  }
  const phone = business.assignedTwilioNumber;
  const pool = await TwilioNumber.findOne({ phoneNumber: phone }).lean();
  const webhooksConfigured = await configureTwilioWebhooksForNumber({
    twilioSid: pool?.twilioSid,
    phoneNumber: phone
  });
  const elevenLabsRegistered = await registerNumberInElevenLabs(phone);
  logProvisioningNumberSetup({ phoneNumber: phone, webhooksConfigured, elevenLabsRegistered });
  return {
    ok: !!(webhooksConfigured || elevenLabsRegistered),
    webhooksConfigured,
    elevenLabsRegistered,
    detail: `Processed ${phone}`
  };
}

/**
 * Bootstrap default Service + Schedule documents if missing.
 */
export async function runServicesAndScheduleBootstrap(slugOrId) {
  const business = await Business.findOne(businessLookupFilter(slugOrId)).lean();
  if (!business) {
    return { ok: false, detail: "Business not found" };
  }
  const bid = canonicalBusinessId(business);
  if (!bid) {
    return { ok: false, detail: "Business has no id/businessId" };
  }

  const result = await ensureBookableDefaultsForBusiness(bid, {
    timezone: business.timezone,
    category: business.category
  });

  return {
    ok: true,
    defaultsEnsured: result.defaultsEnsured,
    servicesEnsured: result.servicesEnsured,
    scheduleEnsured: result.scheduleEnsured,
    servicesCreated: result.servicesCreated,
    detail: result.defaultsEnsured
      ? "Bootstrap created defaults where missing"
      : "Defaults already present or nothing to add"
  };
}

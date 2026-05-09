/**
 * Shared provisioning steps used by internalProvision (n8n retries use tenant.ensure / this stack indirectly).
 */
import { Business } from "../models/Business.js";
import { TwilioNumber } from "../models/TwilioNumber.js";
import {
  configureTwilioWebhooksForNumber,
  registerNumberInElevenLabs,
  logProvisioningNumberSetup
} from "./twilioNumberSetup.js";
import { ensureBookableDefaultsForBusiness } from "./bookableBootstrap.js";
import { isFeatureAllowed } from "../src/config/plans.js";
import { resolveBusinessCountryIso } from "../src/utils/countryCodes.js";
import { pickAvailableTwilioNumber } from "./twilioPoolSelection.js";

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

  const plan = business.plan || "starter";
  if (!isFeatureAllowed(plan, "aiPhoneAgent")) {
    return {
      ok: true,
      skipped: true,
      detail:
        "Phone agent not included on this plan. Upgrade to Growth for a dedicated phone number.",
      plan
    };
  }

  if (business.assignedTwilioNumber) {
    return {
      ok: true,
      skipped: true,
      phone: business.assignedTwilioNumber,
      detail: "Number already assigned"
    };
  }

  const requestedIso = resolveBusinessCountryIso(business);

  let number = null;
  /** @type {{ tier: string, assignedIso: string }|null} */
  let selectionMeta = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const available = await TwilioNumber.find({ status: "available" }).sort({ createdAt: 1 }).lean();
    const picked = pickAvailableTwilioNumber(available, requestedIso);
    if (!picked) break;

    number = await TwilioNumber.findOneAndUpdate(
      { _id: picked.doc._id, status: "available" },
      {
        status: "assigned",
        assignedToBusinessId: bid,
        assignedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    );

    if (number) {
      selectionMeta = { tier: picked.tier, assignedIso: picked.assignedIso };
      break;
    }
  }

  if (!number) {
    await Business.findOneAndUpdate(businessLookupFilter(slugOrId), {
      $set: { numberSetupMethod: "pending" }
    }).catch(() => {});
    console.error(
      "[TWILIO_POOL_EXHAUSTED]",
      JSON.stringify({ businessId: bid, requestedCountry: requestedIso })
    );
    return {
      ok: false,
      detail: "No available Twilio numbers in pool",
      requestedCountry: requestedIso
    };
  }

  if (selectionMeta && selectionMeta.tier !== "country") {
    console.warn(
      "[TWILIO_POOL_COUNTRY_FALLBACK]",
      JSON.stringify({
        businessId: bid,
        requestedCountry: requestedIso,
        assignedCountry: selectionMeta.assignedIso,
        tier: selectionMeta.tier,
        phone: number.phoneNumber
      })
    );
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
    detail: `Assigned ${number.phoneNumber}`,
    requestedCountry: requestedIso,
    assignedCountry: selectionMeta?.assignedIso,
    selectionTier: selectionMeta?.tier
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

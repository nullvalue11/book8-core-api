/**
 * BOO-PHASE4B-2A — Effective inbound phone for wizard/dashboard ("You're Live" step).
 */
import { Business } from "../../models/Business.js";
import { businessLookupFilter } from "../../services/provisioningHelpers.js";
import { DEMO_BUSINESS_ID } from "./demoLine.js";

function normalizeE164(phone) {
  if (!phone || typeof phone !== "string") return "";
  const t = phone.trim().replace(/[^\d+]/g, "");
  if (!t) return "";
  return t.startsWith("+") ? t : `+${t}`;
}

function demoLineFromEnv() {
  return normalizeE164(
    process.env.BOOK8_DEMO_TWILIO_NUMBER ||
      process.env.TWILIO_DEMO_LINE_NUMBER ||
      ""
  );
}

let cachedDemoLineNumber = null;
let cacheLoadedAt = 0;
const CACHE_MS = 60_000;

async function loadDemoLineFromDb() {
  const now = Date.now();
  if (cachedDemoLineNumber && now - cacheLoadedAt < CACHE_MS) {
    return cachedDemoLineNumber;
  }
  const demo = await Business.findOne(businessLookupFilter(DEMO_BUSINESS_ID))
    .select("assignedTwilioNumber")
    .lean();
  cachedDemoLineNumber = normalizeE164(demo?.assignedTwilioNumber) || null;
  cacheLoadedAt = now;
  return cachedDemoLineNumber;
}

/**
 * Shared demo line E.164 (env first, then biz_book8demo record).
 * @returns {Promise<string|null>}
 */
export async function getSharedDemoLineNumber() {
  const fromEnv = demoLineFromEnv();
  if (fromEnv) return fromEnv;
  return loadDemoLineFromDb();
}

/**
 * @param {object|null|undefined} business
 * @returns {Promise<{ phoneNumber: string|null, source: 'dedicated'|'demo_line'|'none', hasDedicatedNumber: boolean, twilioNumberStatus: string|null }>}
 */
export async function getEffectiveBusinessPhone(business) {
  if (!business) {
    return {
      phoneNumber: null,
      source: "none",
      hasDedicatedNumber: false,
      twilioNumberStatus: null
    };
  }

  const dedicated = normalizeE164(business.assignedTwilioNumber);
  if (dedicated) {
    return {
      phoneNumber: dedicated,
      source: "dedicated",
      hasDedicatedNumber: true,
      twilioNumberStatus: business.twilioNumberStatus || "provisioned"
    };
  }

  const demo = await getSharedDemoLineNumber();
  return {
    phoneNumber: demo,
    source: demo ? "demo_line" : "none",
    hasDedicatedNumber: false,
    twilioNumberStatus: business.twilioNumberStatus || "pending"
  };
}

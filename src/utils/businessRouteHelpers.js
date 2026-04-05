// Shared helpers for business HTTP routes (BOO-63A extract from index.js)
import { Business } from "../../models/Business.js";
import { buildPublicBusinessProfile } from "./businessProfile.js";

/** Public booking / widget: no Stripe, plan, Book8 Twilio number, or internal-only fields. */
export function toPublicBusinessPayload(business) {
  const id = business.id ?? business.businessId;
  return {
    _id: business._id,
    id,
    businessId: business.businessId ?? id,
    name: business.name,
    handle: business.handle,
    category: business.category,
    timezone: business.timezone,
    primaryLanguage: business.primaryLanguage,
    multilingualEnabled: business.multilingualEnabled,
    businessProfile: buildPublicBusinessProfile(business)
  };
}

/** book8-ai sends forward|dedicated; schema uses forwarding|direct */
export function mapNumberSetupMethodForSchema(raw) {
  if (raw == null || raw === "") return undefined;
  const s = String(raw).toLowerCase();
  if (s === "forward" || s === "forwarding") return "forwarding";
  if (s === "dedicated" || s === "direct") return "direct";
  if (s === "pending") return "pending";
  return undefined;
}

export function generateSlug(name) {
  if (!name) return null;
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizePhoneNumber(phone) {
  if (!phone) return null;
  const str = String(phone).trim();
  if (!str) return null;
  const normalized = str.replace(/[^\d+]/g, "");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

/** Resolve business by URL param: support both `id` and `businessId` (e.g. biz_xxx from Ops/n8n). */
export async function findBusinessByParam(param) {
  if (!param) return null;
  const business = await Business.findOne({
    $or: [{ id: param }, { businessId: param }]
  }).lean();
  if (!business) return null;
  const businessId = business.id ?? business.businessId;
  return { business: { ...business, id: businessId }, businessId };
}

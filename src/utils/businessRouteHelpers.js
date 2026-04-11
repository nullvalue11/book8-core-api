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

/** URL slug from business display name (BOO-74A). Do not use email or user id. */
export function generateSlug(businessName) {
  if (businessName == null || businessName === "") return null;
  const s = String(businessName)
    .toLowerCase()
    .trim()
    .replace(/_/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || null;
}

/**
 * Public booking slug unique across `handle` and `id` (legacy ids matched the old slug).
 * @param {string} businessName
 * @param {object} [opts]
 * @param {string} [opts.excludingId] - tenant `id`/`businessId` allowed to keep this slug (updates)
 */
export async function generateUniquePublicSlug(businessName, opts = {}) {
  const excludingId = opts.excludingId != null ? String(opts.excludingId) : null;
  let base = generateSlug(businessName);
  if (!base) base = "business";
  let candidate = base;
  let counter = 2;
  for (let i = 0; i < 1000; i++) {
    const found = await Business.findOne({
      $or: [{ id: candidate }, { handle: candidate }]
    }).lean();
    if (!found) return candidate;
    const fid = found.id != null ? String(found.id) : "";
    const fbid = found.businessId != null ? String(found.businessId) : "";
    if (excludingId && (fid === excludingId || fbid === excludingId)) {
      return candidate;
    }
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  throw new Error("Could not allocate a unique public slug");
}

export function normalizePhoneNumber(phone) {
  if (!phone) return null;
  const str = String(phone).trim();
  if (!str) return null;
  const normalized = str.replace(/[^\d+]/g, "");
  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

/**
 * Dashboard sends `x-book8-user-email`; must match root `email`, `businessProfile.email`, or `ownerEmail`.
 */
export function ownerHeaderMatchesBusiness(business, ownerHeader) {
  const h = typeof ownerHeader === "string" ? ownerHeader.trim().toLowerCase() : "";
  if (!h) return false;
  const candidates = [business.email, business.businessProfile?.email, business.ownerEmail];
  for (const c of candidates) {
    if (c != null && String(c).trim().toLowerCase() === h) return true;
  }
  return false;
}

/** Resolve business by URL param: support both `id` and `businessId` (e.g. biz_xxx from Ops/n8n). */
export async function findBusinessByParam(param) {
  if (!param) return null;
  const business = await Business.findOne({
    $or: [{ id: param }, { businessId: param }, { handle: param }]
  }).lean();
  if (!business) return null;
  const businessId = business.id ?? business.businessId;
  return { business: { ...business, id: businessId }, businessId };
}

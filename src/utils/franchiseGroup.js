// BOO-76A — Franchise grouping: same owner + same category (book8-core-api).

import { Business } from "../../models/Business.js";

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Root or businessProfile.email — case-insensitive match */
export function franchiseOwnerEmail(business) {
  if (!business || typeof business !== "object") return "";
  const root = business.email && String(business.email).trim();
  const prof = business.businessProfile?.email && String(business.businessProfile.email).trim();
  return (root || prof || "").toLowerCase();
}

/**
 * Same owner email + same category (lowercased) = franchise siblings.
 * @param {object} business - lean or doc with id, email, businessProfile, category
 * @param {{ excludeSelf?: boolean }} [opts]
 */
export async function getFranchiseSiblings(business, { excludeSelf = true } = {}) {
  const email = franchiseOwnerEmail(business);
  const cat = (business.category != null ? String(business.category) : "").trim().toLowerCase();
  const canonicalId = business.id || business.businessId;
  if (!email || !cat || !canonicalId) return [];

  const emailRe = new RegExp(`^${escapeRegex(email)}$`, "i");
  const q = {
    category: cat,
    $or: [{ email: emailRe }, { "businessProfile.email": emailRe }]
  };
  if (excludeSelf) {
    q.id = { $ne: canonicalId };
  }

  return Business.find(q).sort({ createdAt: 1 }).lean();
}

export async function isFranchiseBusiness(business) {
  const sibs = await getFranchiseSiblings(business);
  return sibs.length > 0;
}

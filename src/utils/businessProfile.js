/**
 * Public business profile for booking pages + validation for PATCH updates.
 */

const E164_RE = /^\+[1-9]\d{1,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isHttpUrl(s) {
  if (s == null || s === "") return true;
  const t = String(s).trim();
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidE164(phone) {
  if (phone == null || phone === "") return true;
  return E164_RE.test(String(phone).trim());
}

export function isValidEmail(email) {
  if (email == null || email === "") return true;
  const t = String(email).trim();
  return t.length <= 254 && EMAIL_RE.test(t);
}

export function validateOptionalUrl(label, value) {
  if (value == null || value === "") return null;
  if (!isHttpUrl(value)) return `${label} must be a valid http(s) URL`;
  return null;
}

/**
 * Merge partial businessProfile onto existing (from DB). Only defined keys are merged.
 */
export function mergeBusinessProfile(existing, partial) {
  const e = existing && typeof existing === "object" ? existing : {};
  const p = partial && typeof partial === "object" ? partial : {};
  const out = { ...e };

  for (const key of ["phone", "email", "website", "description"]) {
    if (p[key] !== undefined) {
      if (p[key] === null || p[key] === "") {
        delete out[key];
      } else {
        out[key] = typeof p[key] === "string" ? p[key].trim() : p[key];
      }
    }
  }

  if (p.address && typeof p.address === "object") {
    out.address = { ...(e.address || {}) };
    for (const ak of ["street", "city", "province", "postalCode", "country"]) {
      if (p.address[ak] !== undefined) {
        if (p.address[ak] === null || p.address[ak] === "") {
          delete out.address[ak];
        } else {
          out.address[ak] = String(p.address[ak]).trim();
        }
      }
    }
    if (Object.keys(out.address).length === 0) delete out.address;
  }

  if (p.socialLinks && typeof p.socialLinks === "object") {
    out.socialLinks = { ...(e.socialLinks || {}) };
    for (const sk of ["instagram", "facebook", "tiktok"]) {
      if (p.socialLinks[sk] !== undefined) {
        if (p.socialLinks[sk] === null || p.socialLinks[sk] === "") {
          delete out.socialLinks[sk];
        } else {
          out.socialLinks[sk] = String(p.socialLinks[sk]).trim();
        }
      }
    }
    if (Object.keys(out.socialLinks).length === 0) delete out.socialLinks;
  }

  return out;
}

/**
 * Validate merged profile. Returns { ok: boolean, error?: string }
 */
export function validateBusinessProfileMerged(profile) {
  if (!profile || typeof profile !== "object") return { ok: true };
  if (!isValidE164(profile.phone)) {
    return { ok: false, error: "businessProfile.phone must be E.164 (e.g. +16135550100)" };
  }
  if (!isValidEmail(profile.email)) {
    return { ok: false, error: "businessProfile.email must be a valid email" };
  }
  if (profile.description != null && String(profile.description).length > 500) {
    return { ok: false, error: "businessProfile.description must be at most 500 characters" };
  }
  let err = validateOptionalUrl("businessProfile.website", profile.website);
  if (err) return { ok: false, error: err };
  for (const sk of ["instagram", "facebook", "tiktok"]) {
    err = validateOptionalUrl(`businessProfile.socialLinks.${sk}`, profile.socialLinks?.[sk]);
    if (err) return { ok: false, error: err };
  }
  return { ok: true };
}

/**
 * Public-safe profile for booking UI. Prefer nested businessProfile; fall back to legacy root fields.
 */
export function buildPublicBusinessProfile(business) {
  const bp = business.businessProfile || {};
  const addr = bp.address || {};
  const rootDesc = business.description;
  const desc =
    bp.description != null && String(bp.description).trim() !== ""
      ? bp.description
      : rootDesc != null && String(rootDesc).trim() !== ""
        ? String(rootDesc).slice(0, 500)
        : null;

  return {
    address: {
      street: addr.street ?? null,
      city: addr.city ?? null,
      province: addr.province ?? null,
      postalCode: addr.postalCode ?? null,
      country: addr.country ?? null
    },
    phone: bp.phone ?? business.phoneNumber ?? null,
    email: bp.email ?? business.email ?? null,
    website: bp.website ?? null,
    description: desc,
    socialLinks: {
      instagram: bp.socialLinks?.instagram ?? null,
      facebook: bp.socialLinks?.facebook ?? null,
      tiktok: bp.socialLinks?.tiktok ?? null
    }
  };
}

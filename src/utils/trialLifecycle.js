/**
 * BOO-97A — Trial lifecycle: 14-day trial, 3-day grace, then hard lock.
 * Timestamps are source of truth; cached trial.status is updated by backfill / billing sync.
 */

const MS_DAY = 24 * 60 * 60 * 1000;

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 3;

function frontendBase() {
  const u = process.env.FRONTEND_URL || "https://www.book8.io";
  return String(u).replace(/\/$/, "");
}

export function upgradeUrlForBusiness(business) {
  const bid = encodeURIComponent(String(business?.id || business?.businessId || ""));
  return `${frontendBase()}/upgrade?businessId=${bid}`;
}

/**
 * Stripe-linked or explicitly marked subscribed (paid).
 * @param {object|null|undefined} business
 * @returns {boolean}
 */
export function isSubscribedBusiness(business) {
  if (!business) return false;
  const sub = business.subscription?.status;
  if (sub === "canceled" || sub === "unpaid" || sub === "incomplete_expired") return false;
  if (sub === "active" || sub === "trialing" || sub === "past_due") return true;
  if (business.trial?.status === "subscribed") return true;
  const plan = business.plan ? String(business.plan).toLowerCase() : "";
  if (business.stripeSubscriptionId && plan && plan !== "none") return true;
  return false;
}

/**
 * @param {object|null|undefined} business
 * @param {number} [nowMs]
 * @returns {'subscribed'|'active'|'grace'|'locked'}
 */
export function computeTrialStatus(business, nowMs = Date.now()) {
  if (!business) return "locked";
  if (isSubscribedBusiness(business)) return "subscribed";

  const trial = business.trial;
  if (!trial || !trial.endsAt || !trial.graceEndsAt) {
    return "active";
  }
  const ends = new Date(trial.endsAt).getTime();
  const graceEnd = new Date(trial.graceEndsAt).getTime();
  if (Number.isNaN(ends) || Number.isNaN(graceEnd)) return "active";
  if (nowMs < ends) return "active";
  if (nowMs < graceEnd) return "grace";
  return "locked";
}

/**
 * Dashboard / API writes (settings, services, schedule, non-voice bookings).
 * @returns {null | { status: number, body: object }}
 */
export function trialDeniedDashboardWrite(business, nowMs = Date.now()) {
  const s = computeTrialStatus(business, nowMs);
  if (s === "subscribed" || s === "active") return null;
  const bid = business?.id || business?.businessId || "";
  if (s === "grace") {
    return {
      status: 402,
      body: {
        ok: false,
        error: "trial_grace_period",
        message: "Trial ended. Dashboard is read-only. Upgrade to keep editing.",
        graceEndsAt: business.trial?.graceEndsAt ?? null,
        upgradeUrl: upgradeUrlForBusiness(business)
      }
    };
  }
  return {
    status: 402,
    body: {
      ok: false,
      error: "trial_expired",
      message: "Trial has ended. Please upgrade to continue.",
      upgradeUrl: upgradeUrlForBusiness(business)
    }
  };
}

/**
 * Public booking flows (availability, voice, SMS) — only hard-lock blocks.
 * @returns {null | { status: number, body: object }}
 */
export function trialDeniedPublicChannel(business, nowMs = Date.now()) {
  const s = computeTrialStatus(business, nowMs);
  if (s !== "locked") return null;
  return {
    status: 402,
    body: {
      ok: false,
      error: "trial_expired",
      message: "This business trial has ended. Please upgrade to continue.",
      upgradeUrl: upgradeUrlForBusiness(business)
    }
  };
}

/**
 * Booking creation: grace blocks web; voice/SMS still allowed until hard lock.
 * @param {object} business
 * @param {object} input
 * @param {string} [input.source]
 * @returns {null | { ok: false, error: string, trialGrace?: boolean, trialExpired?: boolean, upgradeUrl?: string }}
 */
export function getTrialBookingBlock(business, input = {}, nowMs = Date.now()) {
  const source = input.source || "";
  const voice =
    source === "voice-agent" || source === "voice" || source === "sms" || source === "sms-booking";
  const ts = computeTrialStatus(business, nowMs);
  if (ts === "subscribed" || ts === "active") return null;
  if (ts === "grace") {
    if (voice) return null;
    return {
      ok: false,
      error: "Trial ended. Dashboard booking is read-only during grace. Upgrade to book from the web app.",
      trialGrace: true,
      upgradeUrl: upgradeUrlForBusiness(business)
    };
  }
  if (ts === "locked") {
    return {
      ok: false,
      error: "Trial has ended. Please upgrade to continue.",
      trialExpired: true,
      upgradeUrl: upgradeUrlForBusiness(business)
    };
  }
  return null;
}

/**
 * GET /api/businesses/:id/trial-status payload
 * @param {object} business
 */
export function buildTrialStatusPayload(business) {
  const status = computeTrialStatus(business);
  const started = business.trial?.startedAt ? new Date(business.trial.startedAt).toISOString() : null;
  const ends = business.trial?.endsAt ? new Date(business.trial.endsAt) : null;
  const grace = business.trial?.graceEndsAt ? new Date(business.trial.graceEndsAt) : null;
  const now = Date.now();
  let daysRemaining = 0;
  if (ends && status === "active") {
    daysRemaining = Math.max(0, Math.ceil((ends.getTime() - now) / MS_DAY));
  }
  return {
    status,
    trialStartedAt: started,
    trialEndsAt: ends ? ends.toISOString() : null,
    graceEndsAt: grace ? grace.toISOString() : null,
    daysRemaining,
    upgradeUrl: upgradeUrlForBusiness(business)
  };
}

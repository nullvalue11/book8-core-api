/**
 * Idempotent bootstrap of default bookable state for a tenant.
 * Creates default Service and Schedule only when none exist; does not overwrite existing config.
 */

import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";

const DEFAULT_SERVICE_ID = "intro-session-60";
const DEFAULT_SERVICE = {
  serviceId: DEFAULT_SERVICE_ID,
  name: "Intro Session",
  durationMinutes: 60,
  active: true
};

const DEFAULT_WEEKLY_HOURS = {
  monday: [{ start: "09:00", end: "17:00" }],
  tuesday: [{ start: "09:00", end: "17:00" }],
  wednesday: [{ start: "09:00", end: "17:00" }],
  thursday: [{ start: "09:00", end: "17:00" }],
  friday: [{ start: "09:00", end: "17:00" }],
  saturday: [],
  sunday: []
};

/**
 * Ensure at least one default active service exists for the business.
 * Idempotent: if any service already exists for businessId, does nothing.
 * @param {string} businessId
 * @param {string} [timezone] - for consistency, not used on Service
 * @returns {{ ensured: boolean }}
 */
export async function ensureDefaultServicesForBusiness(businessId, timezone) {
  const count = await Service.countDocuments({ businessId });
  if (count > 0) return { ensured: false };

  await Service.create({
    businessId,
    ...DEFAULT_SERVICE
  });
  return { ensured: true };
}

/**
 * Ensure a default weekly schedule exists for the business.
 * Idempotent: if schedule already exists for businessId, does nothing.
 * @param {string} businessId
 * @param {string} [timezone] - America/Toronto if not provided
 * @returns {{ ensured: boolean }}
 */
export async function ensureDefaultScheduleForBusiness(businessId, timezone) {
  const existing = await Schedule.findOne({ businessId }).lean();
  if (existing) return { ensured: false };

  const tz = timezone || "America/Toronto";
  await Schedule.create({
    businessId,
    timezone: tz,
    weeklyHours: { ...DEFAULT_WEEKLY_HOURS }
  });
  return { ensured: true };
}

/**
 * Ensure default bookable state: one default service and default schedule.
 * Idempotent and safe to call multiple times.
 * @param {string} businessId
 * @param {{ timezone?: string }} [opts]
 * @returns {{ defaultsEnsured: boolean, servicesEnsured: boolean, scheduleEnsured: boolean }}
 */
export async function ensureBookableDefaultsForBusiness(businessId, opts = {}) {
  const business = await Business.findOne({ id: businessId }).lean();
  if (!business) return { defaultsEnsured: false, servicesEnsured: false, scheduleEnsured: false };

  const tz = opts.timezone || business.timezone || "America/Toronto";
  const servicesResult = await ensureDefaultServicesForBusiness(businessId, tz);
  const scheduleResult = await ensureDefaultScheduleForBusiness(businessId, tz);

  const defaultsEnsured = servicesResult.ensured || scheduleResult.ensured;
  return {
    defaultsEnsured,
    servicesEnsured: servicesResult.ensured,
    scheduleEnsured: scheduleResult.ensured
  };
}

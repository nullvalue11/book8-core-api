/**
 * Idempotent bootstrap of default bookable state for a tenant.
 * Creates default Service and Schedule only when none exist; does not overwrite existing config.
 */

import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { getDefaultsForCategory } from "./categoryDefaults.js";

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
 * Ensure default services exist for the business based on its category.
 * Idempotent: if any services already exist for businessId, does nothing.
 * @param {string} businessId
 * @param {string} [category] - business category (e.g. "barber", "dental", "fitness")
 * @returns {{ ensured: boolean, servicesCreated: number }}
 */
export async function ensureDefaultServicesForBusiness(businessId, category) {
  const count = await Service.countDocuments({ businessId });
  if (count > 0) return { ensured: false, servicesCreated: 0 };

  const defaults = getDefaultsForCategory(category);

  let created = 0;
  for (const svc of defaults.services) {
    try {
      await Service.create({
        businessId,
        serviceId: svc.serviceId,
        name: svc.name,
        durationMinutes: svc.durationMinutes,
        active: true
      });
      created++;
    } catch (err) {
      if (err.code !== 11000) {
        console.error(`[bookableBootstrap] Error creating service ${svc.serviceId} for ${businessId}:`, err);
      }
    }
  }

  console.log(`[bookableBootstrap] Created ${created} default services for ${businessId} (category: ${category || "other"})`);
  return { ensured: true, servicesCreated: created };
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
 * Ensure default bookable state: category-aware default services and default schedule.
 * Idempotent and safe to call multiple times.
 * @param {string} businessId
 * @param {{ timezone?: string, category?: string }} [opts]
 * @returns {{ defaultsEnsured: boolean, servicesEnsured: boolean, scheduleEnsured: boolean, servicesCreated?: number }}
 */
export async function ensureBookableDefaultsForBusiness(businessId, opts = {}) {
  const business = await Business.findOne({
    $or: [{ id: businessId }, { businessId: businessId }]
  }).lean();
  if (!business) return { defaultsEnsured: false, servicesEnsured: false, scheduleEnsured: false };

  const canonicalId = business.id || business.businessId;
  const tz = opts.timezone || business.timezone || "America/Toronto";
  const category = opts.category || business.category || "other";
  const skipServices = !!opts.skipServices;

  const servicesResult = skipServices
    ? { ensured: false, servicesCreated: 0 }
    : await ensureDefaultServicesForBusiness(canonicalId, category);
  const scheduleResult = await ensureDefaultScheduleForBusiness(canonicalId, tz);

  const defaultsEnsured = servicesResult.ensured || scheduleResult.ensured;
  return {
    defaultsEnsured,
    servicesEnsured: servicesResult.ensured,
    servicesCreated: servicesResult.servicesCreated || 0,
    scheduleEnsured: scheduleResult.ensured
  };
}

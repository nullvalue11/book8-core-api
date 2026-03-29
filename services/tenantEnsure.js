/**
 * Tenant ensure: find business by businessId, or create if not found.
 * Used by /internal/execute-tool for tool "tenant.ensure".
 */

import { Business } from "../models/Business.js";
import { classifyBusinessCategory } from "./categoryClassifier.js";
import { getDefaultServices, getDefaultWeeklySchedule } from "./bootstrapDefaults.js";
import { ensureBookableDefaultsForBusiness } from "./bookableBootstrap.js";

function normalizePhone(phone) {
  if (!phone) return null;
  const str = String(phone).trim().replace(/[^\d+]/g, "");
  return str ? (str.startsWith("+") ? str : `+${str}`) : null;
}

const VALID_PLANS = new Set(["starter", "growth", "enterprise"]);

function normalizePlan(p) {
  if (typeof p !== "string") return null;
  const x = p.toLowerCase();
  return VALID_PLANS.has(x) ? x : null;
}

/**
 * @param {object} input - { businessId, name, description?, category?, timezone?, email?, phoneNumber?, services?, plan? }
 * @returns {Promise<{ ok: boolean, error?: string, businessId?: string, existed?: boolean, created?: boolean }>}
 */
export async function ensureTenant(input) {
  const {
    businessId,
    name,
    description,
    category,
    timezone,
    email,
    phoneNumber,
    services,
    plan: inputPlan
  } = input || {};

  if (!businessId || !name) {
    return { ok: false, error: "businessId and name are required" };
  }

  const resolvedPlan = normalizePlan(inputPlan);

  const existing = await Business.findOne({ id: businessId }).lean();
  if (existing) {
    if (resolvedPlan) {
      await Business.updateOne({ id: businessId }, { $set: { plan: resolvedPlan } }).catch(() => {});
    }
    const tz = timezone || existing.timezone || "America/Toronto";
    const bootstrap = await ensureBookableDefaultsForBusiness(businessId, { timezone: tz });
    return {
      ok: true,
      businessId,
      existed: true,
      created: false,
      defaultsEnsured: bootstrap.defaultsEnsured
    };
  }

  const finalCategory = category || (await classifyBusinessCategory({ name, description }));
  const normalizedPhone = normalizePhone(phoneNumber);
  const tz = timezone || "America/Toronto";
  const servicesToUse = Array.isArray(services) && services.length > 0 ? services : getDefaultServices();
  const weeklyScheduleToUse = getDefaultWeeklySchedule(tz);

  try {
    const business = new Business({
      id: businessId,
      name,
      description: description || undefined,
      category: finalCategory,
      timezone: tz,
      email: email || undefined,
      phoneNumber: normalizedPhone || undefined,
      services: servicesToUse,
      weeklySchedule: weeklyScheduleToUse,
      ...(resolvedPlan ? { plan: resolvedPlan } : {})
    });

    await business.save();

    const bootstrap = await ensureBookableDefaultsForBusiness(business.id, { timezone: tz });

    return {
      ok: true,
      businessId,
      existed: false,
      created: true,
      defaultsEnsured: bootstrap.defaultsEnsured
    };
  } catch (err) {
    if (err.code === 11000) {
      const existing = await Business.findOne({ id: businessId }).lean();
      if (existing) {
        return { ok: true, businessId, existed: true, created: false };
      }
    }
    throw err;
  }
}

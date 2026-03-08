/**
 * Tenant ensure: find business by businessId, or create if not found.
 * Used by /internal/execute-tool for tool "tenant.ensure".
 */

import { Business } from "../models/Business.js";
import { classifyBusinessCategory } from "./categoryClassifier.js";

function normalizePhone(phone) {
  if (!phone) return null;
  const str = String(phone).trim().replace(/[^\d+]/g, "");
  return str ? (str.startsWith("+") ? str : `+${str}`) : null;
}

/**
 * @param {object} input - { businessId, name, description?, category?, timezone?, email?, phoneNumber?, services? }
 * @returns {Promise<{ ok: boolean, error?: string, businessId?: string, existed?: boolean, created?: boolean }>}
 */
export async function ensureTenant(input) {
  const { businessId, name, description, category, timezone, email, phoneNumber, services } = input || {};

  if (!businessId || !name) {
    return { ok: false, error: "businessId and name are required" };
  }

  const existing = await Business.findOne({ id: businessId }).lean();
  if (existing) {
    return {
      ok: true,
      businessId,
      existed: true,
      created: false
    };
  }

  const finalCategory = category || (await classifyBusinessCategory({ name, description }));
  const normalizedPhone = normalizePhone(phoneNumber);

  try {
    const business = new Business({
      id: businessId,
      name,
      description: description || undefined,
      category: finalCategory,
      timezone: timezone || "America/Toronto",
      email: email || undefined,
      phoneNumber: normalizedPhone || undefined,
      services: Array.isArray(services) ? services : undefined
    });

    await business.save();

    return {
      ok: true,
      businessId,
      existed: false,
      created: true
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

// BOO-76A — Sync Service documents + embedded business.services across franchise siblings.

import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { getFranchiseSiblings } from "../src/utils/franchiseGroup.js";

function log(msg) {
  console.log(`[franchise-sync] ${msg}`);
}

export async function refreshBusinessEmbeddedServices(canonicalBusinessId) {
  const rows = await Service.find({ businessId: canonicalBusinessId }).lean();
  const embedded = rows.map((s) => ({
    id: s.serviceId,
    name: s.name,
    duration: s.durationMinutes,
    price: s.price != null ? s.price : 0,
    active: s.active !== false
  }));
  await Business.updateOne({ id: canonicalBusinessId }, { $set: { services: embedded } }).catch(() => {});
}

async function forSelfAndSiblings(canonicalId, fn) {
  const business = await Business.findOne({ id: canonicalId }).lean();
  if (!business) return;
  const siblings = await getFranchiseSiblings(business);
  const targets = [canonicalId, ...siblings.map((s) => s.id).filter(Boolean)];
  const seen = new Set();
  for (const bid of targets) {
    if (!bid || seen.has(bid)) continue;
    seen.add(bid);
    await fn(bid);
  }
}

/**
 * After Service.create on canonicalId.
 * @param {string} canonicalBusinessId
 * @param {object} serviceDoc - mongoose doc or plain { serviceId, name, durationMinutes, price, currency, active }
 */
export async function franchiseSyncAfterServiceCreate(canonicalBusinessId, serviceDoc) {
  const business = await Business.findOne({ id: canonicalBusinessId }).lean();
  if (!business) return;
  const siblings = await getFranchiseSiblings(business);
  if (siblings.length === 0) {
    await refreshBusinessEmbeddedServices(canonicalBusinessId);
    return;
  }

  const payload = {
    serviceId: serviceDoc.serviceId,
    name: serviceDoc.name,
    durationMinutes: Number(serviceDoc.durationMinutes),
    price: serviceDoc.price != null ? serviceDoc.price : null,
    currency: serviceDoc.currency || "USD",
    active: serviceDoc.active !== false
  };

  for (const sib of siblings) {
    const bid = sib.id;
    await Service.findOneAndUpdate(
      { businessId: bid, serviceId: payload.serviceId },
      {
        $set: {
          name: payload.name,
          durationMinutes: payload.durationMinutes,
          price: payload.price,
          currency: String(payload.currency || "USD")
            .trim()
            .toUpperCase()
            .slice(0, 3),
          active: payload.active
        },
        $setOnInsert: {
          businessId: bid,
          serviceId: payload.serviceId
        }
      },
      { upsert: true, new: true }
    ).catch((e) => log(`upsert sibling ${bid}: ${e.message}`));
    log(`Created/updated service "${payload.name}" (${payload.serviceId}) on ${bid}`);
    await refreshBusinessEmbeddedServices(bid);
  }
  await refreshBusinessEmbeddedServices(canonicalBusinessId);
}

/**
 * After Service.findOneAndUpdate for one business.
 */
export async function franchiseSyncAfterServiceUpdate(canonicalBusinessId, serviceId, updateFields) {
  const business = await Business.findOne({ id: canonicalBusinessId }).lean();
  if (!business) return;
  const siblings = await getFranchiseSiblings(business);
  if (siblings.length === 0) {
    await refreshBusinessEmbeddedServices(canonicalBusinessId);
    return;
  }

  const set = {};
  if (updateFields.name !== undefined) set.name = updateFields.name;
  if (updateFields.durationMinutes !== undefined) set.durationMinutes = updateFields.durationMinutes;
  if (updateFields.active !== undefined) set.active = updateFields.active;
  if (updateFields.price !== undefined) set.price = updateFields.price;
  if (updateFields.currency !== undefined) set.currency = updateFields.currency;

  if (Object.keys(set).length === 0) {
    await refreshBusinessEmbeddedServices(canonicalBusinessId);
    return;
  }

  for (const sib of siblings) {
    const bid = sib.id;
    const r = await Service.updateOne({ businessId: bid, serviceId }, { $set: set });
    if (r.matchedCount) {
      log(`Updated service ${serviceId} on ${bid}`);
      await refreshBusinessEmbeddedServices(bid);
    }
  }
  await refreshBusinessEmbeddedServices(canonicalBusinessId);
}

/**
 * Copy all services from earliest sibling into newBusinessId. Deletes existing Service rows for newBusinessId first.
 * @returns {Promise<boolean>} true if copy ran
 */
export async function copyFranchiseServicesToNewBusiness(newBusinessId) {
  const newBiz = await Business.findOne({
    $or: [{ id: newBusinessId }, { businessId: newBusinessId }]
  }).lean();
  if (!newBiz) return false;
  const siblings = await getFranchiseSiblings(newBiz);
  if (siblings.length === 0) return false;

  const sourceId = siblings[0].id;
  const sourceServices = await Service.find({ businessId: sourceId, active: true }).lean();
  if (sourceServices.length === 0) return false;

  await Service.deleteMany({ businessId: newBusinessId }).catch(() => {});

  for (const s of sourceServices) {
    try {
      await Service.create({
        businessId: newBusinessId,
        serviceId: s.serviceId,
        name: s.name,
        durationMinutes: s.durationMinutes,
        price: s.price,
        currency: s.currency || "USD",
        active: s.active !== false
      });
    } catch (e) {
      if (e.code !== 11000) log(`create ${newBusinessId} ${s.serviceId}: ${e.message}`);
    }
  }
  await refreshBusinessEmbeddedServices(newBusinessId);
  log(`Copied ${sourceServices.length} services from ${sourceId} → ${newBusinessId}`);
  return true;
}

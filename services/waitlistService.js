// BOO-59A: waitlist business logic
import { randomBytes } from "crypto";
import { Waitlist } from "../models/Waitlist.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { getPlanFeatures } from "../src/config/plans.js";
import { isFeatureAllowed } from "./planLimits.js";
import { formatSlotDateTime } from "./localeFormat.js";
import { calendarDateFromSlotStart } from "./waitlistSlot.js";
import { signWaitlistCancelToken, verifyWaitlistCancelToken } from "./waitlistToken.js";
import {
  publicBookingPageUrl,
  sendWaitlistJoinNotifications,
  sendWaitlistSlotAvailableNotifications,
  sendWaitlistExpiredNotifications
} from "./waitlistMessages.js";

const NOTIFICATION_MS = 4 * 60 * 60 * 1000;
const WAITLIST_HOLD_DAYS = 14;

export function generateWaitlistId() {
  const suffix = randomBytes(9).toString("base64url").replace(/[-_]/g, "X").slice(0, 12);
  return `wl_${suffix}`;
}

function normPhone(p) {
  if (!p) return "";
  return String(p).replace(/[^\d+]/g, "");
}

function customerMatchesWaitlist(c, bookingCustomer) {
  if (!c || !bookingCustomer) return false;
  const em = (a) => (a || "").trim().toLowerCase();
  if (c.email && bookingCustomer.email && em(c.email) === em(bookingCustomer.email)) return true;
  if (c.phone && bookingCustomer.phone && normPhone(c.phone) === normPhone(bookingCustomer.phone)) {
    return true;
  }
  return false;
}

export function matchesWaitlistForBooking(w, booking, slotDate) {
  if (!w.preferredDates?.length) return false;
  if (!w.preferredDates.includes(slotDate)) return false;
  if (w.serviceId && w.serviceId !== booking.serviceId) return false;
  const bid = booking.providerId ? String(booking.providerId) : "";
  if (w.providerId && String(w.providerId) !== bid) return false;
  return true;
}

export async function findFirstMatchingWaitlistEntry(businessId, booking, slotDate) {
  const waiting = await Waitlist.find({
    businessId,
    status: "waiting",
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } }]
  })
    .sort({ createdAt: 1 })
    .lean();

  for (const w of waiting) {
    if (matchesWaitlistForBooking(w, booking, slotDate)) return w;
  }
  return null;
}

async function resolveServiceName(businessId, serviceId) {
  if (!serviceId) return "Appointment";
  try {
    const svc = await Service.findOne({ businessId, serviceId }).lean();
    if (svc?.name) return svc.name;
  } catch {
    // ignore
  }
  return serviceId || "Appointment";
}

async function transitionToNotifiedAndNotify(entry, booking, business, slotDate, serviceName) {
  const tz = booking.slot?.timezone || business.timezone || "America/Toronto";
  const normStart = new Date(booking.slot.start).toISOString();
  const normEnd = new Date(booking.slot.end).toISOString();

  const updated = await Waitlist.findOneAndUpdate(
    { id: entry.id, status: "waiting" },
    {
      $set: {
        status: "notified",
        notifiedAt: new Date(),
        notifiedSlot: { date: slotDate, start: normStart, end: normEnd },
        offerServiceId: booking.serviceId,
        offerProviderId: booking.providerId || null,
        notificationExpiresAt: new Date(Date.now() + NOTIFICATION_MS)
      }
    },
    { new: true }
  ).lean();

  if (!updated) return false;

  const { dateStr, timeStr } = formatSlotDateTime(booking.slot.start, tz, updated.language || "en");
  const bookLink = publicBookingPageUrl(business);
  await sendWaitlistSlotAvailableNotifications(business, updated, {
    serviceName,
    dateStr,
    timeStr,
    bookLink
  });
  return true;
}

export async function processWaitlistForFreedBooking(booking) {
  const business = await Business.findOne({
    $or: [{ id: booking.businessId }, { businessId: booking.businessId }]
  }).lean();
  if (!business) return;
  const plan = business.plan || "starter";
  if (!isFeatureAllowed(plan, "waitlist")) return;

  const tz = booking.slot?.timezone || business.timezone || "America/Toronto";
  const slotDate = calendarDateFromSlotStart(booking.slot.start, tz);
  if (!slotDate) return;

  const businessId = business.id ?? business.businessId;
  const entry = await findFirstMatchingWaitlistEntry(businessId, booking, slotDate);
  if (!entry) return;

  const serviceName = await resolveServiceName(businessId, booking.serviceId);
  await transitionToNotifiedAndNotify(entry, booking, business, slotDate, serviceName);
}

/** Fire-and-forget after cancellation. */
export function notifyWaitlistAfterCancellation(booking) {
  (async () => {
    try {
      await processWaitlistForFreedBooking(booking);
    } catch (err) {
      console.error("[waitlist] notifyWaitlistAfterCancellation:", err.message);
    }
  })();
}

export async function countActiveWaitlistEntries(businessId) {
  return Waitlist.countDocuments({
    businessId,
    status: { $in: ["waiting", "notified"] }
  });
}

export async function joinWaitlist(businessId, body) {
  const business = await Business.findOne({
    $or: [{ id: businessId }, { businessId }]
  }).lean();
  if (!business) {
    return { ok: false, status: 404, error: "Business not found" };
  }
  const canonicalId = business.id ?? business.businessId;
  const plan = business.plan || "starter";
  if (!isFeatureAllowed(plan, "waitlist")) {
    return {
      ok: false,
      status: 403,
      error: "Waitlist is not available on your plan.",
      requiredPlan: "growth",
      upgrade: true
    };
  }

  const max = getPlanFeatures(plan).maxWaitlistEntries ?? 0;
  if (max !== -1) {
    const n = await countActiveWaitlistEntries(canonicalId);
    if (n >= max) {
      return { ok: false, status: 403, error: "Waitlist is full for this business." };
    }
  }

  const {
    serviceId,
    serviceName: inputServiceName,
    providerId,
    providerName,
    customer,
    preferredDates,
    preferredTimeRange,
    language
  } = body || {};

  if (!customer?.name || typeof customer.name !== "string") {
    return { ok: false, status: 400, error: "customer.name is required" };
  }
  if (!Array.isArray(preferredDates) || preferredDates.length === 0) {
    return { ok: false, status: 400, error: "preferredDates must be a non-empty array of date strings (YYYY-MM-DD)" };
  }

  const serviceName =
    inputServiceName ||
    (serviceId ? await resolveServiceName(canonicalId, serviceId) : "Any service");

  const expiresAt = new Date(Date.now() + WAITLIST_HOLD_DAYS * 24 * 60 * 60 * 1000);
  const lang =
    typeof language === "string" && language.trim() ? language.trim().toLowerCase().slice(0, 5) : "en";

  const doc = await Waitlist.create({
    id: generateWaitlistId(),
    businessId: canonicalId,
    serviceId: serviceId || null,
    serviceName,
    providerId: providerId || null,
    providerName: providerName || null,
    customer: {
      name: customer.name.trim(),
      email: customer.email ? String(customer.email).trim() : "",
      phone: customer.phone ? String(customer.phone).trim() : ""
    },
    preferredDates: preferredDates.map((d) => String(d).trim()).filter(Boolean),
    preferredTimeRange: preferredTimeRange || undefined,
    language: lang,
    status: "waiting",
    expiresAt
  });

  const ahead = await Waitlist.countDocuments({
    businessId: canonicalId,
    status: "waiting",
    createdAt: { $lt: doc.createdAt }
  });
  const position = ahead + 1;

  const bookingLink = publicBookingPageUrl(business);
  await sendWaitlistJoinNotifications(business, doc.toObject(), { serviceName, bookingLink });

  let cancelToken = null;
  try {
    cancelToken = signWaitlistCancelToken(doc.id, canonicalId);
  } catch {
    // secret missing in dev
  }

  return {
    ok: true,
    waitlistId: doc.id,
    position,
    cancelToken
  };
}

export async function listWaitlistEntries(businessId, query) {
  const business = await Business.findOne({
    $or: [{ id: businessId }, { businessId }]
  }).lean();
  if (!business) return { ok: false, status: 404, error: "Business not found" };
  const canonicalId = business.id ?? business.businessId;

  const filter = { businessId: canonicalId };
  if (query.status) filter.status = query.status;
  if (query.serviceId) filter.serviceId = query.serviceId;
  if (query.date) filter.preferredDates = query.date;

  const entries = await Waitlist.find(filter).sort({ createdAt: 1 }).lean();
  return { ok: true, businessId: canonicalId, entries };
}

export async function removeWaitlistEntry(businessParam, waitlistId, auth) {
  const business = await Business.findOne({
    $or: [{ id: businessParam }, { businessId: businessParam }]
  }).lean();
  if (!business) return { ok: false, status: 404, error: "Business not found" };
  const canonicalId = business.id ?? business.businessId;

  if (auth.type === "token") {
    const v = verifyWaitlistCancelToken(auth.token);
    if (!v.ok || v.waitlistId !== waitlistId || v.businessId !== canonicalId) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
  } else if (auth.type !== "internal") {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const result = await Waitlist.deleteOne({ id: waitlistId, businessId: canonicalId });
  if (result.deletedCount === 0) {
    return { ok: false, status: 404, error: "Waitlist entry not found" };
  }
  return { ok: true };
}

export async function tryMarkWaitlistBooked(waitlistId, bookingDoc) {
  if (!waitlistId || typeof waitlistId !== "string") return;
  const w = await Waitlist.findOne({ id: waitlistId }).lean();
  if (!w || w.status !== "notified") return;
  if (w.businessId !== bookingDoc.businessId) return;
  if (w.notificationExpiresAt && new Date(w.notificationExpiresAt) < new Date()) return;
  const ns = w.notifiedSlot;
  if (!ns?.start) return;
  if (new Date(bookingDoc.slot.start).getTime() !== new Date(ns.start).getTime()) return;
  if (!customerMatchesWaitlist(w.customer, bookingDoc.customer)) return;

  await Waitlist.updateOne(
    { id: waitlistId },
    { $set: { status: "booked", bookedBookingId: bookingDoc.id } }
  );
}

export async function processWaitlistCronJobs() {
  const now = new Date();
  let expiredWaiting = 0;
  let expiredNotifications = 0;
  let renotified = 0;

  const staleWaiting = await Waitlist.find({
    status: "waiting",
    expiresAt: { $lt: now }
  }).lean();

  for (const w of staleWaiting) {
    try {
      const business = await Business.findOne({
        $or: [{ id: w.businessId }, { businessId: w.businessId }]
      }).lean();
      if (!business) continue;
      await Waitlist.updateOne({ id: w.id }, { $set: { status: "expired" } });
      expiredWaiting++;
      const bookingLink = publicBookingPageUrl(business);
      await sendWaitlistExpiredNotifications(business, w, {
        serviceName: w.serviceName || "Appointment",
        bookingLink
      });
    } catch (err) {
      console.error("[waitlist cron] expired waiting:", w.id, err.message);
    }
  }

  const staleNotified = await Waitlist.find({
    status: "notified",
    notificationExpiresAt: { $lt: now }
  }).lean();

  for (const w of staleNotified) {
    try {
      const business = await Business.findOne({
        $or: [{ id: w.businessId }, { businessId: w.businessId }]
      }).lean();
      if (!business) continue;
      await Waitlist.updateOne({ id: w.id }, { $set: { status: "expired" } });
      expiredNotifications++;

      if (!w.notifiedSlot?.start || !w.notifiedSlot?.end) continue;

      const bookingLike = {
        businessId: w.businessId,
        serviceId: w.offerServiceId || w.serviceId,
        providerId: w.offerProviderId || undefined,
        slot: {
          start: w.notifiedSlot.start,
          end: w.notifiedSlot.end,
          timezone: business.timezone || "America/Toronto"
        }
      };
      const slotDate = w.notifiedSlot.date;
      const businessId = business.id ?? business.businessId;
      const plan = business.plan || "starter";
      if (!isFeatureAllowed(plan, "waitlist")) continue;

      const next = await findFirstMatchingWaitlistEntry(businessId, bookingLike, slotDate);
      if (!next) continue;

      const serviceName = await resolveServiceName(businessId, bookingLike.serviceId);
      const ok = await transitionToNotifiedAndNotify(next, bookingLike, business, slotDate, serviceName);
      if (ok) renotified++;
    } catch (err) {
      console.error("[waitlist cron] stale notified:", w.id, err.message);
    }
  }

  return { expiredWaiting, expiredNotifications, renotified };
}

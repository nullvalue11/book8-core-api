import { randomBytes } from "crypto";
import { Review } from "../models/Review.js";
import { Booking } from "../models/Booking.js";
import { Service } from "../models/Service.js";
import { verifyReviewToken } from "./reviewToken.js";
import { refreshBusinessReviewStats } from "./reviewStats.js";

export function generateReviewId() {
  const suffix = randomBytes(9).toString("base64url").replace(/[-_]/g, "X").slice(0, 12);
  return `rev_${suffix}`;
}

function firstName(fullName) {
  if (!fullName || typeof fullName !== "string") return "";
  return fullName.trim().split(/\s+/)[0] || "";
}

function toPublicReview(doc) {
  return {
    id: doc.id,
    businessId: doc.businessId,
    providerName: doc.providerName ?? null,
    serviceName: doc.serviceName,
    customerName: doc.customerName,
    rating: doc.rating,
    comment: doc.comment || "",
    language: doc.language || "en",
    createdAt: doc.createdAt
  };
}

/**
 * @param {{ token: string, rating: unknown, comment?: string }} body
 */
export async function submitPublicReview(body) {
  const { token, rating, comment } = body || {};
  if (!token || typeof token !== "string") {
    return { ok: false, status: 400, error: "token is required" };
  }

  const v = verifyReviewToken(token);
  if (!v.ok) {
    return { ok: false, status: 400, error: v.error };
  }

  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return { ok: false, status: 400, error: "rating must be an integer from 1 to 5" };
  }

  let commentStr = comment == null ? "" : String(comment);
  if (commentStr.length > 500) {
    return { ok: false, status: 400, error: "comment must be at most 500 characters" };
  }

  const booking = await Booking.findOne({ id: v.bookingId }).lean();
  if (!booking) {
    return { ok: false, status: 404, error: "Booking not found" };
  }
  if (booking.businessId !== v.businessId) {
    return { ok: false, status: 400, error: "Invalid token" };
  }

  const existing = await Review.findOne({ bookingId: booking.id }).lean();
  if (existing) {
    return { ok: false, status: 409, error: "Review already submitted for this booking" };
  }

  let serviceName = booking.serviceId || "Appointment";
  try {
    const svc = await Service.findOne({
      businessId: booking.businessId,
      serviceId: booking.serviceId
    }).lean();
    if (svc?.name) serviceName = svc.name;
  } catch {
    // ignore
  }

  const customerName = firstName(booking.customer?.name);
  const lang = (booking.language || "en").toLowerCase().slice(0, 16);

  try {
    const doc = await Review.create({
      id: generateReviewId(),
      businessId: booking.businessId,
      bookingId: booking.id,
      providerId: booking.providerId || null,
      providerName: booking.providerName || null,
      serviceName,
      customerName,
      rating: r,
      comment: commentStr,
      language: lang,
      status: "published"
    });
    await refreshBusinessReviewStats(booking.businessId);
    return { ok: true, review: toPublicReview(doc.toObject()) };
  } catch (err) {
    if (err?.code === 11000) {
      return { ok: false, status: 409, error: "Review already submitted for this booking" };
    }
    throw err;
  }
}

/**
 * @param {string} businessId - canonical id
 * @param {number} page
 * @param {number} limit
 */
export async function listPublicReviewsForBusiness(businessId, page, limit) {
  const skip = (page - 1) * limit;
  const filter = { businessId, status: "published" };

  const [total, agg, rows] = await Promise.all([
    Review.countDocuments(filter),
    Review.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: "$rating" }
        }
      }
    ]),
    Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  const totalReviews = total;
  const row = agg[0];
  const averageRating =
    total === 0 ? 0 : row ? Math.round(row.averageRating * 10) / 10 : 0;

  return {
    averageRating,
    totalReviews,
    reviews: rows.map((d) => toPublicReview(d)),
    page,
    limit,
    totalPages,
    hasMore: skip + rows.length < total
  };
}

/**
 * @param {string} reviewId - rev_…
 * @param {'hidden'|'published'} status
 */
export async function setReviewStatus(reviewId, status) {
  if (!reviewId || typeof reviewId !== "string") {
    return { ok: false, status: 400, error: "review id is required" };
  }
  if (status !== "hidden" && status !== "published") {
    return { ok: false, status: 400, error: "status must be hidden or published" };
  }

  const doc = await Review.findOne({ id: reviewId });
  if (!doc) {
    return { ok: false, status: 404, error: "Review not found" };
  }

  doc.status = status;
  await doc.save();
  await refreshBusinessReviewStats(doc.businessId);
  return { ok: true, review: toPublicReview(doc.toObject()) };
}

import { Review } from "../models/Review.js";
import { Business } from "../models/Business.js";

/**
 * Recompute published-review aggregates for a business and persist on Business.reviewStats.
 * @param {string} businessId - canonical business id (matches Booking.businessId / Business.id)
 */
export async function refreshBusinessReviewStats(businessId) {
  const agg = await Review.aggregate([
    { $match: { businessId, status: "published" } },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        averageRating: { $avg: "$rating" },
        lastReviewAt: { $max: "$createdAt" }
      }
    }
  ]);
  const row = agg[0];
  const averageRating = row ? Math.round(row.averageRating * 10) / 10 : 0;
  const totalReviews = row ? row.totalReviews : 0;
  const lastReviewAt = row?.lastReviewAt || null;

  await Business.updateOne(
    { $or: [{ id: businessId }, { businessId }] },
    {
      $set: {
        reviewStats: {
          averageRating,
          totalReviews,
          lastReviewAt
        }
      }
    }
  );
}

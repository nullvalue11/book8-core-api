// models/RateLimitBucket.js — durable fixed-window rate limit buckets (BOO-RATELIMIT-CORE-1A)
import mongoose from "mongoose";

const RateLimitBucketSchema = new mongoose.Schema(
  {
    bucketKey: { type: String, required: true, maxlength: 512, trim: true },
    namespace: { type: String, required: true, maxlength: 128, trim: true },
    count: { type: Number, required: true, default: 0, min: 0 },
    windowStart: { type: Date, required: true },
    resetAt: { type: Date, required: true }
  },
  { timestamps: true, collection: "rate_limit_buckets" }
);

RateLimitBucketSchema.index({ bucketKey: 1 }, { unique: true });
RateLimitBucketSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitBucket =
  mongoose.models.RateLimitBucket ||
  mongoose.model("RateLimitBucket", RateLimitBucketSchema);

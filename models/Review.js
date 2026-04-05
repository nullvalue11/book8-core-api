// models/Review.js — BOO-58A client reviews
import mongoose from "mongoose";

const ReviewSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true, maxlength: 128, trim: true },
    businessId: { type: String, required: true, index: true, maxlength: 128, trim: true },
    bookingId: { type: String, maxlength: 128, trim: true },
    providerId: { type: String, maxlength: 128, trim: true, default: null },
    providerName: { type: String, maxlength: 200, trim: true, default: null },
    serviceName: { type: String, maxlength: 200, trim: true },
    customerName: { type: String, maxlength: 200, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500, trim: true, default: "" },
    language: { type: String, maxlength: 16, trim: true, default: "en" },
    status: {
      type: String,
      enum: ["pending", "published", "hidden"],
      default: "published"
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ReviewSchema.index({ bookingId: 1 }, { unique: true, sparse: true });
ReviewSchema.index({ businessId: 1, status: 1, createdAt: -1 });

export const Review =
  mongoose.models.Review || mongoose.model("Review", ReviewSchema);

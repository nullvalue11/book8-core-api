// models/Waitlist.js — BOO-59A waitlist
import mongoose from "mongoose";

const CustomerSchema = new mongoose.Schema(
  {
    name: { type: String, maxlength: 200, trim: true },
    email: { type: String, maxlength: 254, trim: true },
    phone: { type: String, maxlength: 32, trim: true }
  },
  { _id: false }
);

const PreferredTimeRangeSchema = new mongoose.Schema(
  {
    earliest: { type: String, maxlength: 16, trim: true },
    latest: { type: String, maxlength: 16, trim: true }
  },
  { _id: false }
);

const NotifiedSlotSchema = new mongoose.Schema(
  {
    date: { type: String, maxlength: 32, trim: true },
    start: { type: String, maxlength: 64, trim: true },
    end: { type: String, maxlength: 64, trim: true }
  },
  { _id: false }
);

const WaitlistSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true, maxlength: 128, trim: true },
    businessId: { type: String, required: true, index: true, maxlength: 128, trim: true },
    serviceId: { type: String, maxlength: 128, trim: true, default: null },
    serviceName: { type: String, maxlength: 200, trim: true },
    providerId: { type: String, maxlength: 128, trim: true, default: null },
    providerName: { type: String, maxlength: 200, trim: true, default: null },
    customer: { type: CustomerSchema, required: true },
    preferredDates: [{ type: String, maxlength: 32, trim: true }],
    preferredTimeRange: { type: PreferredTimeRangeSchema, default: undefined },
    language: { type: String, maxlength: 16, trim: true, default: "en" },
    status: {
      type: String,
      enum: ["waiting", "notified", "booked", "expired", "cancelled"],
      default: "waiting",
      index: true
    },
    notifiedAt: { type: Date },
    notifiedSlot: { type: NotifiedSlotSchema, default: undefined },
    /** Snapshot from freed booking when status → notified (for rolling offers). */
    offerServiceId: { type: String, maxlength: 128, trim: true, default: null },
    offerProviderId: { type: String, maxlength: 128, trim: true, default: null },
    notificationExpiresAt: { type: Date },
    bookedBookingId: { type: String, maxlength: 128, trim: true, default: null },
    expiresAt: { type: Date, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

WaitlistSchema.index({ businessId: 1, status: 1, createdAt: 1 });
WaitlistSchema.index({ businessId: 1, preferredDates: 1, status: 1 });

export const Waitlist =
  mongoose.models.Waitlist || mongoose.model("Waitlist", WaitlistSchema);

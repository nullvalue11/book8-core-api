// models/TwilioNumber.js
import mongoose from "mongoose";

const TwilioNumberSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["available", "assigned", "reserved"],
      default: "available"
    },
    assignedToBusinessId: { type: String, default: null },
    assignedAt: { type: Date, default: null },
    twilioSid: { type: String },
    /** ISO 3166-1 alpha-2 — drives country-aware pool assignment (BOO-TWILIO-UAE-NUMBERS-1A). */
    country: { type: String, maxlength: 2, uppercase: true, sparse: true, index: true },
    areaCode: { type: String },
    capabilities: {
      voice: { type: Boolean, default: true },
      sms: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
);

TwilioNumberSchema.index({ status: 1 });
TwilioNumberSchema.index({ assignedToBusinessId: 1 });

export const TwilioNumber =
  mongoose.models.TwilioNumber || mongoose.model("TwilioNumber", TwilioNumberSchema);

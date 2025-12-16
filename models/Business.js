// models/Business.js
import mongoose from "mongoose";

const ServiceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    duration: { type: Number, required: true }, // minutes
    price: { type: Number, required: true }
  },
  { _id: false }
);

const BookingSettingsSchema = new mongoose.Schema(
  {
    minNoticeMinutes: { type: Number, default: 60 },
    maxAdvanceDays: { type: Number, default: 30 },
    requireEmail: { type: Boolean, default: true },
    requirePhone: { type: Boolean, default: true }
  },
  { _id: false }
);

const BusinessSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true }, // slug/handle e.g. "waismofit"
    name: { type: String, required: true },
    category: { type: String, default: "fitness" }, // fitness, car_wash, salon, ...
    description: { type: String },
    timezone: { type: String, default: "America/Toronto" },

    phoneNumber: { type: String },
    email: { type: String },

    greetingOverride: { type: String },

    services: [ServiceSchema],
    bookingSettings: BookingSettingsSchema
  },
  { timestamps: true }
);

export const Business =
  mongoose.models.Business || mongoose.model("Business", BusinessSchema);

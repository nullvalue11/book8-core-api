// models/Business.js
import mongoose from "mongoose";

const ServiceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    duration: { type: Number, required: true }, // minutes
    price: { type: Number, default: 0 },
    active: { type: Boolean, default: true }
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

const WeeklyScheduleSchema = new mongoose.Schema(
  {
    timezone: { type: String, default: "America/Toronto" },
    weeklyHours: {
      type: mongoose.Schema.Types.Mixed,
      default: function () {
        return {
          monday: [{ start: "09:00", end: "17:00" }],
          tuesday: [{ start: "09:00", end: "17:00" }],
          wednesday: [{ start: "09:00", end: "17:00" }],
          thursday: [{ start: "09:00", end: "17:00" }],
          friday: [{ start: "09:00", end: "17:00" }]
        };
      }
    }
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

    phoneNumber: { type: String, index: true, unique: true, sparse: true },
    email: { type: String },

    assignedTwilioNumber: { type: String, index: true, unique: true, sparse: true },
    forwardingEnabled: { type: Boolean, default: false },
    forwardingFrom: [String],

    greetingOverride: { type: String },

    services: [ServiceSchema],
    bookingSettings: BookingSettingsSchema,
    weeklySchedule: WeeklyScheduleSchema
  },
  { timestamps: true }
);

export const Business =
  mongoose.models.Business || mongoose.model("Business", BusinessSchema);

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

/** Mirrors book8-ai business.calendar — must be in schema or paths can be omitted on read/write. */
const CalendarSchema = new mongoose.Schema(
  {
    connected: { type: Boolean, default: false },
    provider: { type: String, enum: ["google", "microsoft", null], default: null },
    updatedAt: { type: Date }
  },
  { _id: false }
);

const BusinessSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true }, // slug/handle e.g. "waismofit"
    /** Duplicate of `id` for dashboard alignment; optional until migrated */
    businessId: { type: String, index: true, sparse: true },
    /** Public URL slug for /b/:handle (may mirror `id`) */
    handle: { type: String, index: true, sparse: true },
    name: { type: String, required: true },
    category: { type: String, default: "fitness" }, // fitness, car_wash, salon, ...
    description: { type: String },
    timezone: { type: String, default: "America/Toronto" },

    phoneNumber: { type: String, index: true, unique: true, sparse: true },
    email: { type: String },

    assignedTwilioNumber: { type: String, index: true, unique: true, sparse: true },
    forwardingEnabled: { type: Boolean, default: false },
    forwardingFrom: [String],
    // Phone number setup method chosen during onboarding
    // "forwarding" = business keeps their number, forwards to Book8 Twilio number
    // "direct" = business uses the assigned Twilio number directly
    // "pending" = hasn't completed setup yet
    numberSetupMethod: { type: String, enum: ["forwarding", "direct", "pending"], default: "pending" },

    greetingOverride: { type: String },

    // Stripe billing linkage + plan
    stripeCustomerId: { type: String, index: true, sparse: true },
    stripeSubscriptionId: { type: String, sparse: true },
    plan: {
      type: String,
      enum: ["starter", "growth", "enterprise"],
      default: "starter"
    },

    // Calendar provider used for availability and booking sync (top-level; may be set by provisioning).
    calendarProvider: { type: String, enum: ["google", "microsoft", null], default: null },
    // Nested calendar state (often synced from book8-ai).
    calendar: CalendarSchema,

    services: [ServiceSchema],
    bookingSettings: BookingSettingsSchema,
    weeklySchedule: WeeklyScheduleSchema
  },
  { timestamps: true }
);

export const Business =
  mongoose.models.Business || mongoose.model("Business", BusinessSchema);

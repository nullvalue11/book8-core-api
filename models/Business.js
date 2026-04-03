// models/Business.js
import mongoose from "mongoose";

const ServiceSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 128, trim: true },
    name: { type: String, required: true, maxlength: 200, trim: true },
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
    timezone: { type: String, default: "America/Toronto", maxlength: 64, trim: true },
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

const BusinessProfileAddressSchema = new mongoose.Schema(
  {
    street: { type: String, maxlength: 200, trim: true },
    city: { type: String, maxlength: 120, trim: true },
    province: { type: String, maxlength: 120, trim: true },
    postalCode: { type: String, maxlength: 32, trim: true },
    country: { type: String, maxlength: 120, trim: true }
  },
  { _id: false }
);

const BusinessProfileSocialSchema = new mongoose.Schema(
  {
    instagram: { type: String, maxlength: 512, trim: true },
    facebook: { type: String, maxlength: 512, trim: true },
    tiktok: { type: String, maxlength: 512, trim: true }
  },
  { _id: false }
);

const BusinessProfileLogoSchema = new mongoose.Schema(
  {
    url: { type: String, maxlength: 2048, trim: true },
    publicId: { type: String, maxlength: 512, trim: true }
  },
  { _id: false }
);

/** Public-facing contact + bio for booking pages (distinct from Book8 Twilio / root onboarding fields). */
const BusinessProfileSchema = new mongoose.Schema(
  {
    address: BusinessProfileAddressSchema,
    phone: { type: String, maxlength: 32, trim: true },
    email: { type: String, maxlength: 254, trim: true },
    website: { type: String, maxlength: 2048, trim: true },
    description: { type: String, maxlength: 500, trim: true },
    socialLinks: BusinessProfileSocialSchema,
    logo: BusinessProfileLogoSchema
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
    id: { type: String, unique: true, index: true, maxlength: 128, trim: true }, // slug/handle e.g. "waismofit"
    /** Duplicate of `id` for dashboard alignment; optional until migrated */
    businessId: { type: String, index: true, sparse: true, maxlength: 128, trim: true },
    /** Public URL slug for /b/:handle (may mirror `id`) */
    handle: { type: String, index: true, sparse: true, maxlength: 128, trim: true },
    name: { type: String, required: true, maxlength: 200, trim: true },
    category: { type: String, default: "fitness", maxlength: 64, trim: true }, // fitness, car_wash, salon, ...
    description: { type: String, maxlength: 4000, trim: true },
    timezone: { type: String, default: "America/Toronto", maxlength: 64, trim: true },

    phoneNumber: { type: String, index: true, unique: true, sparse: true, maxlength: 32, trim: true },
    email: { type: String, maxlength: 254, trim: true },

    /** Nested public profile for /b/[handle]; root email/phone/description remain for legacy/onboarding. */
    businessProfile: BusinessProfileSchema,

    assignedTwilioNumber: { type: String, index: true, unique: true, sparse: true, maxlength: 32, trim: true },
    forwardingEnabled: { type: Boolean, default: false },
    forwardingFrom: [{ type: String, maxlength: 32, trim: true }],
    // Phone number setup method chosen during onboarding
    // "forwarding" = business keeps their number, forwards to Book8 Twilio number
    // "direct" = business uses the assigned Twilio number directly
    // "pending" = hasn't completed setup yet
    numberSetupMethod: { type: String, enum: ["forwarding", "direct", "pending"], default: "pending" },

    /** Dashboard phone setup wizard: new number vs call forwarding */
    phoneSetup: { type: String, enum: ["new", "forward"], default: "new" },
    existingBusinessNumber: { type: String, maxlength: 32, trim: true },

    greetingOverride: { type: String, maxlength: 2000, trim: true },

    primaryLanguage: { type: String, default: "en", maxlength: 16, trim: true },
    multilingualEnabled: { type: Boolean, default: true },
    supportedLanguages: [{ type: String, maxlength: 16, trim: true }],

    // Stripe billing linkage + plan
    stripeCustomerId: { type: String, index: true, sparse: true, maxlength: 128, trim: true },
    stripeSubscriptionId: { type: String, sparse: true, maxlength: 128, trim: true },
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

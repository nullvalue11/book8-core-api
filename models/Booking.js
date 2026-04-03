// models/Booking.js
import mongoose from "mongoose";

const CustomerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 200, trim: true },
    phone: { type: String, maxlength: 32, trim: true },
    email: { type: String, maxlength: 254, trim: true }
  },
  { _id: false }
);

const SlotSchema = new mongoose.Schema(
  {
    start: { type: String, required: true, maxlength: 64, trim: true },
    end: { type: String, required: true, maxlength: 64, trim: true },
    timezone: { type: String, required: true, maxlength: 64, trim: true }
  },
  { _id: false }
);

const BookingSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true, maxlength: 128, trim: true },
    businessId: { type: String, required: true, index: true, maxlength: 128, trim: true },
    serviceId: { type: String, required: true, maxlength: 128, trim: true },
    /** BOO-44A: optional staff/provider when business uses multi-provider */
    providerId: { type: String, maxlength: 128, trim: true, default: null },
    providerName: { type: String, maxlength: 200, trim: true, default: null },
    customer: { type: CustomerSchema, required: true },
    slot: { type: SlotSchema, required: true },
    status: { type: String, default: "confirmed", maxlength: 32, trim: true },
    source: { type: String, default: "voice-agent", maxlength: 64, trim: true },
    /** ISO 639-1 (e.g. en, fr, es, ar); drives SMS/email confirmation language */
    language: { type: String, default: "en", maxlength: 5, trim: true, lowercase: true },
    notes: { type: String, maxlength: 1000, trim: true },

    /** Google/Outlook calendar event id from book8-ai after successful create */
    calendarEventId: { type: String, default: null, maxlength: 512, trim: true },

    cancelledAt: { type: Date },
    cancellationMethod: { type: String, enum: ["sms", "dashboard", "phone", "api"], maxlength: 32, trim: true },

    // SMS tracking
    confirmationSentAt: { type: Date },
    confirmationSid: { type: String, maxlength: 64, trim: true },
    reminderSentAt: { type: Date },
    reminderSid: { type: String, maxlength: 64, trim: true },
    shortReminderSentAt: { type: Date },
    shortReminderSid: { type: String, maxlength: 64, trim: true },
    lastMinuteReminderSentAt: { type: Date },
    lastMinuteReminderSid: { type: String, maxlength: 64, trim: true },

    // Email tracking
    confirmationEmailSentAt: { type: Date },
    confirmationEmailId: { type: String, maxlength: 256, trim: true },
    reminderEmailSentAt: { type: Date },
    reminderEmailId: { type: String, maxlength: 256, trim: true },
    shortReminderEmailSentAt: { type: Date },
    shortReminderEmailId: { type: String, maxlength: 256, trim: true },
    lastMinuteReminderEmailSentAt: { type: Date },
    lastMinuteReminderEmailId: { type: String, maxlength: 256, trim: true },

    /** BOO-45A: Stripe card on file (SetupIntent + PaymentMethod) */
    stripeCustomerId: { type: String, maxlength: 128, trim: true, sparse: true },
    stripePaymentMethodId: { type: String, maxlength: 128, trim: true, sparse: true },
    cardLast4: { type: String, maxlength: 8, trim: true },
    cardBrand: { type: String, maxlength: 32, trim: true },

    noShow: { type: Boolean, default: false },
    noShowMarkedAt: { type: Date },
    noShowCharged: { type: Boolean, default: false },
    noShowChargedAt: { type: Date },
    noShowChargeAmount: { type: Number },
    noShowChargeId: { type: String, maxlength: 128, trim: true },

    cancellationFeeCharged: { type: Boolean, default: false },
    cancellationFeeChargedAt: { type: Date },
    cancellationFeeAmount: { type: Number },
    cancellationFeeChargeId: { type: String, maxlength: 128, trim: true },

    /** SMS two-step cancel when a fee may apply */
    smsCancelAwaitingConfirm: { type: Boolean, default: false },
    smsCancelPromptSentAt: { type: Date }
  },
  { timestamps: true }
);

// RACE CONDITION FIX: Prevent double-booking at the DB level.
// Two concurrent calls can both pass the isSlotAvailable() read check
// and then both write a booking for the same slot. This unique index
// ensures MongoDB rejects the second write with a duplicate key error
// (code 11000), which bookingService.js catches and returns as
// "slot no longer available."
// partialFilterExpression limits the constraint to confirmed bookings
// only, so cancelled bookings don't block future slots.
BookingSchema.index(
  { businessId: 1, "slot.start": 1, providerId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "confirmed" }
  }
);

// Performance index for the overlap query in isSlotAvailable()
BookingSchema.index({
  businessId: 1,
  status: 1,
  "slot.start": 1,
  "slot.end": 1
});

export const Booking =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

// models/Booking.js
import mongoose from "mongoose";

const CustomerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String },
    email: { type: String }
  },
  { _id: false }
);

const SlotSchema = new mongoose.Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
    timezone: { type: String, required: true }
  },
  { _id: false }
);

const BookingSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, index: true },
    businessId: { type: String, required: true, index: true },
    serviceId: { type: String, required: true },
    customer: { type: CustomerSchema, required: true },
    slot: { type: SlotSchema, required: true },
    status: { type: String, default: "confirmed" },
    source: { type: String, default: "voice-agent" },
    notes: { type: String },

    /** Google/Outlook calendar event id from book8-ai after successful create */
    calendarEventId: { type: String, default: null },

    cancelledAt: { type: Date },
    cancellationMethod: { type: String, enum: ["sms", "dashboard", "phone", "api"] },

    // SMS tracking
    confirmationSentAt: { type: Date },
    confirmationSid: { type: String },
    reminderSentAt: { type: Date },
    reminderSid: { type: String },
    shortReminderSentAt: { type: Date },
    shortReminderSid: { type: String },
    lastMinuteReminderSentAt: { type: Date },
    lastMinuteReminderSid: { type: String },

    // Email tracking
    confirmationEmailSentAt: { type: Date },
    confirmationEmailId: { type: String },
    reminderEmailSentAt: { type: Date },
    reminderEmailId: { type: String },
    shortReminderEmailSentAt: { type: Date },
    shortReminderEmailId: { type: String },
    lastMinuteReminderEmailSentAt: { type: Date },
    lastMinuteReminderEmailId: { type: String }
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
  { businessId: 1, "slot.start": 1, status: 1 },
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

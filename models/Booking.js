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
    notes: { type: String }
  },
  { timestamps: true }
);

export const Booking =
  mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

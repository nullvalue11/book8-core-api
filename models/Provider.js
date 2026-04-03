// models/Provider.js — BOO-44A staff/providers per business
import mongoose from "mongoose";

const AvatarSchema = new mongoose.Schema(
  {
    url: { type: String, maxlength: 2048, trim: true },
    publicId: { type: String, maxlength: 512, trim: true }
  },
  { _id: false }
);

/** Per-day hours: { open, close, isOpen } — converted to slot blocks in calendarAvailability */
const DayHoursSchema = new mongoose.Schema(
  {
    open: { type: String, maxlength: 8, trim: true },
    close: { type: String, maxlength: 8, trim: true },
    isOpen: { type: Boolean, default: false }
  },
  { _id: false }
);

const WeeklyProviderScheduleSchema = new mongoose.Schema(
  {
    monday: DayHoursSchema,
    tuesday: DayHoursSchema,
    wednesday: DayHoursSchema,
    thursday: DayHoursSchema,
    friday: DayHoursSchema,
    saturday: DayHoursSchema,
    sunday: DayHoursSchema
  },
  { _id: false }
);

const ProviderSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true, maxlength: 128, trim: true },
    businessId: { type: String, required: true, index: true, maxlength: 128, trim: true },
    name: { type: String, required: true, maxlength: 200, trim: true },
    title: { type: String, maxlength: 200, trim: true },
    avatar: AvatarSchema,
    email: { type: String, maxlength: 254, trim: true },
    phone: { type: String, maxlength: 32, trim: true },
    services: [{ type: String, maxlength: 128, trim: true }],
    schedule: {
      weeklyHours: WeeklyProviderScheduleSchema
    },
    calendarId: { type: String, maxlength: 512, trim: true },
    calendarProvider: { type: String, enum: ["google", "outlook"], default: undefined },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }
  },
  { timestamps: true }
);

ProviderSchema.index({ businessId: 1, id: 1 }, { unique: true });
ProviderSchema.index({ businessId: 1, isActive: 1, sortOrder: 1 });

export const Provider =
  mongoose.models.Provider || mongoose.model("Provider", ProviderSchema);

// models/Schedule.js
import mongoose from "mongoose";

const ScheduleSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, unique: true, index: true },
    timezone: { type: String, required: true, default: "America/Toronto" },
    weeklyHours: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: function () {
        return {
          monday: [{ start: "09:00", end: "17:00" }],
          tuesday: [{ start: "09:00", end: "17:00" }],
          wednesday: [{ start: "09:00", end: "17:00" }],
          thursday: [{ start: "09:00", end: "17:00" }],
          friday: [{ start: "09:00", end: "17:00" }],
          saturday: [],
          sunday: []
        };
      }
    }
  },
  { timestamps: true }
);

export const Schedule =
  mongoose.models.Schedule || mongoose.model("Schedule", ScheduleSchema);

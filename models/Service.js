// models/Service.js
import mongoose from "mongoose";

const ServiceSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, index: true, maxlength: 128, trim: true },
    serviceId: { type: String, required: true, maxlength: 128, trim: true },
    name: { type: String, required: true, maxlength: 200, trim: true },
    durationMinutes: { type: Number, required: true },
    price: { type: Number, default: null, min: 0 },
    currency: { type: String, default: "USD", maxlength: 3, trim: true, uppercase: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

ServiceSchema.index({ businessId: 1, serviceId: 1 }, { unique: true });

export const Service =
  mongoose.models.Service || mongoose.model("Service", ServiceSchema);

/**
 * Generate a safe serviceId from a name (slug-style, lowercase, hyphens).
 * Caller should ensure uniqueness per business (e.g. append duration or suffix if needed).
 * @param {string} name - e.g. "Intro Session"
 * @returns {string} - e.g. "intro-session"
 */
export function generateServiceIdFromName(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

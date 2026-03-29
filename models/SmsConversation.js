// models/SmsConversation.js — state for two-way SMS booking (LLM + availability)
import mongoose from "mongoose";

const SmsMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["customer", "assistant"], required: true, maxlength: 16, trim: true },
    text: { type: String, required: true, maxlength: 8000, trim: true },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const SmsConversationSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, index: true, maxlength: 128, trim: true },
    customerPhone: { type: String, required: true, index: true, maxlength: 32, trim: true },
    state: {
      type: String,
      default: "greeting",
      maxlength: 64,
      trim: true
    },
    context: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    messages: [SmsMessageSchema],
    expiresAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

SmsConversationSchema.index({ businessId: 1, customerPhone: 1, expiresAt: 1 });

export const SmsConversation =
  mongoose.models.SmsConversation || mongoose.model("SmsConversation", SmsConversationSchema);

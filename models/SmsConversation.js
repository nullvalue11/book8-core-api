// models/SmsConversation.js — state for two-way SMS booking (LLM + availability)
import mongoose from "mongoose";

const SmsMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["customer", "assistant"], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const SmsConversationSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, index: true },
    customerPhone: { type: String, required: true, index: true },
    state: {
      type: String,
      default: "greeting"
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

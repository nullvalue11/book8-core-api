// src/models/WhatsappConversation.js — BOO-INFOBIP-INBOUND-WEBHOOK-1A
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    type: {
      type: String,
      enum: ["text", "audio", "image", "document", "video", "location", "sticker", "unknown"],
      required: true
    },
    content: {
      text: String,
      mediaUrl: String,
      mediaMimeType: String,
      durationSeconds: Number,
      transcription: String,
      transcriptionLanguage: String
    },
    meta: {
      model: String,
      promptTokens: Number,
      completionTokens: Number,
      totalTokens: Number,
      latencyMs: Number,
      toolCalls: [{ type: String }]
    },
    rawPayload: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const whatsappConversationSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, index: true },
    customerPhone: { type: String, required: true, index: true },
    customerName: { type: String },
    status: { type: String, enum: ["active", "archived"], default: "active" },
    windowExpiresAt: { type: Date },
    lastInboundMessageAt: { type: Date, index: true },
    language: { type: String, default: "en" },
    messages: [messageSchema],
    startedAt: { type: Date, default: Date.now },
    lastMessageAt: { type: Date, default: Date.now }
  },
  { timestamps: true, collection: "whatsappConversations" }
);

whatsappConversationSchema.index({ businessId: 1, customerPhone: 1 }, { unique: true });
whatsappConversationSchema.index({ lastMessageAt: -1 });
whatsappConversationSchema.index({ "messages.messageId": 1 }, { unique: true, sparse: true });

export const WhatsappConversation =
  mongoose.models.WhatsappConversation ||
  mongoose.model("WhatsappConversation", whatsappConversationSchema);

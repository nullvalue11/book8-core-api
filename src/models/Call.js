// src/models/Call.js
import mongoose from "mongoose";

const TranscriptEntrySchema = new mongoose.Schema(
  {
    turnId: { type: String, maxlength: 256, trim: true }, // optional but recommended
    role: { type: String, enum: ["caller", "agent"], required: true, maxlength: 16, trim: true },
    text: { type: String, required: true, maxlength: 12000, trim: true },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const ToolEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, maxlength: 256, trim: true }, // optional but recommended
    name: { type: String, required: true, maxlength: 128, trim: true },
    success: { type: Boolean, default: true },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const CallSchema = new mongoose.Schema(
  {
    callSid: { type: String, required: true, unique: true, index: true },

    // IMPORTANT: business handle string (waismofit, cutzbarber, etc.)
    businessId: { type: String, required: true, index: true },

    fromNumber: { type: String },
    toNumber: { type: String },

    status: {
      type: String,
      enum: ["initiated", "in_progress", "completed", "failed"],
      default: "initiated"
    },

    startTime: { type: Date, default: Date.now, index: true },
    endTime: { type: Date },
    durationSeconds: { type: Number },

    transcript: { type: [TranscriptEntrySchema], default: [] },
    toolsUsed: { type: [ToolEventSchema], default: [] },

    usage: {
      llmTokens: { type: Number, default: 0 },
      ttsCharacters: { type: Number, default: 0 },
      // placeholder; do not rely on it yet
      sttSeconds: { type: Number, default: 0 }
    },

    // ElevenLabs call data (populated by post-call webhook)
    elevenLabs: {
      conversationId: { type: String, maxlength: 128, trim: true },
      agentId: { type: String, maxlength: 128, trim: true },
      callSuccessful: { type: String, maxlength: 32, trim: true }, // "success", "failure", "unknown"
      transcriptSummary: { type: String, maxlength: 8000, trim: true },
      cost: { type: Number }, // ElevenLabs credit cost
      terminationReason: { type: String, maxlength: 512, trim: true },
      failureReason: { type: String, maxlength: 512, trim: true } // For call_initiation_failure events
    },

    /** ISO 639-1 code from ElevenLabs post-call (default en if unknown) */
    language: { type: String, default: "en", maxlength: 16, trim: true },
    languageDetected: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// Query patterns we'll actually use later
CallSchema.index({ businessId: 1, startTime: -1 });
CallSchema.index({ startTime: -1 });
CallSchema.index({ "elevenLabs.conversationId": 1 }, { sparse: true });

// Speeds idempotency checks (optional but recommended)
CallSchema.index({ callSid: 1, "transcript.turnId": 1 });
CallSchema.index({ callSid: 1, "toolsUsed.eventId": 1 });

export const Call =
  mongoose.models.Call || mongoose.model("Call", CallSchema);

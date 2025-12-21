// src/models/Call.js
import mongoose from "mongoose";

const TranscriptEntrySchema = new mongoose.Schema(
  {
    turnId: { type: String }, // optional but recommended
    role: { type: String, enum: ["caller", "agent"], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const ToolEventSchema = new mongoose.Schema(
  {
    eventId: { type: String }, // optional but recommended
    name: { type: String, required: true },
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
    }
  },
  { timestamps: true }
);

// Query patterns we'll actually use later
CallSchema.index({ businessId: 1, startTime: -1 });
CallSchema.index({ startTime: -1 });

// Speeds idempotency checks (optional but recommended)
CallSchema.index({ callSid: 1, "transcript.turnId": 1 });
CallSchema.index({ callSid: 1, "toolsUsed.eventId": 1 });

export const Call = mongoose.model("Call", CallSchema);

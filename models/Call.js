// models/Call.js
import mongoose from "mongoose";

const TranscriptEntrySchema = new mongoose.Schema(
  {
    turnId: { type: String, required: true, index: true },
    role: { type: String, required: true }, // "user" or "assistant"
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const ToolCallSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, index: true },
    toolName: { type: String, required: true },
    args: mongoose.Schema.Types.Mixed, // Using 'args' instead of 'arguments' (reserved word)
    result: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const CallSchema = new mongoose.Schema(
  {
    callSid: { type: String, unique: true, index: true }, // Twilio Call SID
    businessId: { type: String, required: true, index: true }, // Business handle like "waismofit"
    from: { type: String }, // Caller's phone number
    to: { type: String }, // Called number (Twilio number)
    status: { type: String, default: "ringing" }, // ringing, in-progress, completed, failed
    duration: { type: Number }, // seconds
    
    transcript: [TranscriptEntrySchema],
    toolCalls: [ToolCallSchema]
  },
  { timestamps: true }
);

export const Call =
  mongoose.models.Call || mongoose.model("Call", CallSchema);


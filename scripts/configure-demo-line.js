#!/usr/bin/env node
/**
 * BOO-DEMO-LINE-1A — configure biz_book8demo with demo Twilio number and metadata.
 *
 *   BOOK8_DEMO_TWILIO_NUMBER="+1343..." MONGODB_URI="..." node scripts/configure-demo-line.js --dry-run
 *   BOOK8_DEMO_TWILIO_NUMBER="+1343..." MONGODB_URI="..." node scripts/configure-demo-line.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Business } from "../models/Business.js";
import { businessLookupFilter } from "../services/provisioningHelpers.js";
import { DEMO_BUSINESS_ID } from "../src/utils/demoLine.js";

const dryRun = process.argv.includes("--dry-run");
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const twilioRaw =
  process.env.BOOK8_DEMO_TWILIO_NUMBER ||
  process.env.TWILIO_DEMO_LINE_NUMBER ||
  process.env.__TWILIO_NUMBER__;

function normalizeE164(phone) {
  if (!phone || typeof phone !== "string") return "";
  const t = phone.trim().replace(/[^\d+]/g, "");
  if (!t) return "";
  return t.startsWith("+") ? t : `+${t}`;
}

const SUPPORTED_LANGUAGES = [
  "en",
  "fr",
  "es",
  "ar",
  "zh",
  "hi",
  "pt",
  "de",
  "it",
  "ja",
  "ko",
  "ru",
  "tr",
  "vi",
  "tl",
  "th",
  "pl",
  "nl"
];

async function main() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  const assignedTwilioNumber = normalizeE164(twilioRaw);
  if (!assignedTwilioNumber || assignedTwilioNumber.includes("__TWILIO")) {
    console.error(
      "Set BOOK8_DEMO_TWILIO_NUMBER (E.164, e.g. +13435551234) before running this script."
    );
    process.exit(1);
  }

  await mongoose.connect(uri);

  let doc = await Business.findOne(businessLookupFilter(DEMO_BUSINESS_ID));
  const metadata = {
    isDemoLine: true,
    purpose:
      "Public Book8 AI demo line — vertical-agnostic, demonstrates product to prospects",
    promptVersion: "V1",
    promptFile: "prompts/BOOK8_AI_DEMO_AGENT_PROMPT_V1.md"
  };

  const patch = {
    id: DEMO_BUSINESS_ID,
    businessId: DEMO_BUSINESS_ID,
    name: "Book8 AI Demo Line",
    assignedTwilioNumber,
    twilioNumberStatus: "provisioned",
    primaryLanguage: "en",
    supportedLanguages: SUPPORTED_LANGUAGES,
    multilingualEnabled: true,
    category: "demo",
    timezone: "America/Toronto",
    email: "wais@book8.io",
    forwardingEnabled: false,
    phoneSetup: "new",
    numberSetupMethod: "direct",
    plan: "enterprise",
    availableChannels: { voice: true, whatsapp: false, sms: false },
    metadata,
    greetingOverride: undefined
  };

  if (dryRun) {
    console.log("[configure-demo-line] dry-run would apply:", {
      businessId: DEMO_BUSINESS_ID,
      assignedTwilioNumber,
      exists: !!doc,
      metadata
    });
    await mongoose.disconnect();
    return;
  }

  if (!doc) {
    doc = new Business(patch);
  } else {
    Object.assign(doc, patch);
  }

  doc.markModified("metadata");
  doc.markModified("availableChannels");
  doc.markModified("supportedLanguages");
  await doc.save();

  console.log("[configure-demo-line] saved", {
    id: doc.id,
    assignedTwilioNumber: doc.assignedTwilioNumber,
    category: doc.category,
    plan: doc.plan
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[configure-demo-line] failed:", err);
  process.exit(1);
});

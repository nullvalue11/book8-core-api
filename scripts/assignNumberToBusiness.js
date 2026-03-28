#!/usr/bin/env node
/**
 * Manually assign a Twilio pool number to a business and run post-assign setup.
 *
 * Usage:
 *   node scripts/assignNumberToBusiness.js <businessId>
 *
 * Env:
 *   MONGODB_URI or MONGO_URI (required)
 */
import "dotenv/config";
import mongoose from "mongoose";
import {
  assignTwilioNumberFromPool,
  configureWebhooksAndElevenLabsForBusiness
} from "../services/provisioningHelpers.js";

const businessId = process.argv[2];
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!businessId) {
  console.error("Usage: node scripts/assignNumberToBusiness.js <businessId>");
  process.exit(1);
}

if (!uri) {
  console.error("Missing MONGODB_URI or MONGO_URI");
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri);
  console.log(`[assignNumberToBusiness] Connected. businessId=${businessId}`);

  const assignResult = await assignTwilioNumberFromPool(businessId);
  console.log(
    "[assignNumberToBusiness] assignTwilioNumberFromPool:",
    JSON.stringify(assignResult, null, 2)
  );

  // Ensure post-assignment integration steps are attempted, even if number was already assigned.
  if (typeof configureWebhooksAndElevenLabsForBusiness === "function") {
    const setupResult = await configureWebhooksAndElevenLabsForBusiness(businessId);
    console.log(
      "[assignNumberToBusiness] configureWebhooksAndElevenLabsForBusiness:",
      JSON.stringify(setupResult, null, 2)
    );
  } else {
    console.log(
      "[assignNumberToBusiness] configureWebhooksAndElevenLabsForBusiness helper not found; skipped."
    );
  }

  const assigned = assignResult?.phone || "(none)";
  console.log(`[assignNumberToBusiness] Assigned number: ${assigned}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[assignNumberToBusiness] Error:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

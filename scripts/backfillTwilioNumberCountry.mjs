#!/usr/bin/env node
/**
 * Backfill TwilioNumber.country (ISO alpha-2) from E.164 when missing (BOO-TWILIO-UAE-NUMBERS-1A).
 *
 * Usage:
 *   node scripts/backfillTwilioNumberCountry.mjs
 *
 * Env: MONGODB_URI or MONGO_URI (book8-core DB used by API).
 */
import "dotenv/config";
import mongoose from "mongoose";

import { TwilioNumber } from "../models/TwilioNumber.js";
import { inferCountryIsoFromE164 } from "../src/utils/countryCodes.js";

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("Set MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const cursor = TwilioNumber.find({
    $or: [{ country: { $exists: false } }, { country: null }, { country: "" }]
  })
    .cursor()
    .addCursorFlag("noCursorTimeout", false);

  let updated = 0;
  let skipped = 0;

  for await (const row of cursor) {
    const iso = inferCountryIsoFromE164(row.phoneNumber);
    if (!iso) {
      skipped++;
      continue;
    }
    await TwilioNumber.updateOne({ _id: row._id }, { $set: { country: iso.toUpperCase() } });
    updated++;
  }

  console.log(JSON.stringify({ updated, skipped }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* */
  }
  process.exit(1);
});

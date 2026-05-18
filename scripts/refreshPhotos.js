#!/usr/bin/env node
/**
 * BOO-PHOTO-REFRESH-1A — one-time refresh of Google Places photo references.
 *
 *   MONGODB_URI="..." node scripts/refreshPhotos.js --dry-run
 *   MONGODB_URI="..." node scripts/refreshPhotos.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import { refreshBusinessPhotos } from "../services/refreshBusinessPhotos.js";

const BUSINESS_IDS = [
  "biz_mnmqsh4xnfygae", // Diamond Car Wash Rideau
  "biz_mnmmr26lnj5ug5" // Diamond Car Wash Findlay Creek
];

const dryRun = process.argv.includes("--dry-run");
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function main() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`[refreshPhotos] dryRun=${dryRun} businesses=${BUSINESS_IDS.length}`);

  for (const id of BUSINESS_IDS) {
    const result = await refreshBusinessPhotos(id, { dryRun });
    console.log(`${id}:`, JSON.stringify(result));
  }

  await mongoose.disconnect();
  console.log("Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

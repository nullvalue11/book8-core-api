/**
 * Remove legacy (e.g. haircut) services for Diamond Car Wash businesses; keep only the three
 * car wash SKUs. Deduplicate by name (keeps earliest _id). Refreshes embedded business.services.
 *
 * Usage: node scripts/cleanupCarWashServices.mjs
 * Requires MONGODB_URI (env or .env).
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Service } from "../models/Service.js";
import { refreshBusinessEmbeddedServices } from "../services/franchiseServiceSync.js";

const BUSINESS_IDS = ["biz_mnmmr26lnj5ug5", "biz_mnmqsh4xnfygae"];

const ALLOWED_NAMES = new Set([
  "Full Wash - Interior Only",
  "Full Wash - Exterior Only",
  "Full Wash - Interior & Exterior"
]);

function normName(n) {
  return typeof n === "string" ? n.trim() : "";
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set. Aborting.");
  process.exit(1);
}

await mongoose.connect(uri);
try {
  for (const businessId of BUSINESS_IDS) {
    const all = await Service.find({ businessId }).sort({ _id: 1 }).lean();
    const idsToDelete = [];
    const seenAllowedName = new Set();

    for (const s of all) {
      const key = normName(s.name);
      if (!ALLOWED_NAMES.has(key)) {
        idsToDelete.push(s._id);
        continue;
      }
      if (seenAllowedName.has(key)) {
        idsToDelete.push(s._id);
      } else {
        seenAllowedName.add(key);
      }
    }

    if (idsToDelete.length) {
      const r = await Service.deleteMany({ _id: { $in: idsToDelete } });
      console.log(`${businessId}: deleted ${r.deletedCount} service(s) (non-allowed + duplicates)`);
    } else {
      console.log(`${businessId}: nothing to delete`);
    }

    await refreshBusinessEmbeddedServices(businessId);
    console.log(`${businessId}: embedded services refreshed`);
  }
} finally {
  await mongoose.disconnect();
}

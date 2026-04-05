/**
 * Print name + emails for business ids (core-api MongoDB).
 * Usage:
 *   MONGODB_URI=<uri> node scripts/lookupBusinessesById.mjs biz_xxx biz_yyy
 * Or from repo root with .env:
 *   node scripts/lookupBusinessesById.mjs biz_mmpsyemadcrxuc biz_mnjbw8rfi94sf1
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Business } from "../models/Business.js";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const ids = process.argv.slice(2).filter(Boolean);

if (!uri) {
  console.error("MONGODB_URI or MONGO_URI is required");
  process.exit(1);
}
if (ids.length === 0) {
  console.error("Usage: node scripts/lookupBusinessesById.mjs <businessId> [businessId...]");
  process.exit(1);
}

await mongoose.connect(uri);

for (const id of ids) {
  const doc = await Business.findOne({ $or: [{ id }, { businessId: id }] })
    .select("id businessId name email businessProfile.email phoneNumber")
    .lean();
  if (!doc) {
    console.log(`--- ${id} ---\n  NOT FOUND\n`);
    continue;
  }
  const bid = doc.id ?? doc.businessId;
  const profileEmail = doc.businessProfile?.email || "";
  console.log(`--- ${bid} ---`);
  console.log(`  name:            ${doc.name ?? ""}`);
  console.log(`  email (root):    ${doc.email ?? ""}`);
  console.log(`  email (profile): ${profileEmail}`);
  console.log(`  phone:           ${doc.phoneNumber ?? ""}`);
  console.log("");
}

await mongoose.disconnect();

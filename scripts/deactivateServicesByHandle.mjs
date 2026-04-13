/**
 * One-off: set active=false on services whose names match patterns (case-insensitive).
 * Usage: node scripts/deactivateServicesByHandle.mjs <handle-or-id> [substring1] [substring2] ...
 * Default substrings (case-insensitive contains): "fade + beard trim", "hot towel shave"
 *
 * Example:
 *   node scripts/deactivateServicesByHandle.mjs shining-smile-ottawa
 *   node scripts/deactivateServicesByHandle.mjs shining-smile-ottawa "custom name"
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";

const MONGODB_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/book8-core";

const handleOrId = process.argv[2];
const extra = process.argv.slice(3);
const needles =
  extra.length > 0
    ? extra.map((s) => s.toLowerCase())
    : ["fade + beard trim", "hot towel shave"];

if (!handleOrId) {
  console.error("Usage: node scripts/deactivateServicesByHandle.mjs <handle-or-business-id> [substrings...]");
  process.exit(1);
}

function nameMatches(name) {
  const n = String(name || "").toLowerCase();
  return needles.some((k) => n.includes(k));
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const biz = await Business.findOne({
    $or: [{ handle: handleOrId }, { id: handleOrId }, { businessId: handleOrId }]
  }).lean();
  if (!biz) {
    console.error("Business not found for:", handleOrId);
    process.exit(1);
  }
  const bid = biz.id || biz.businessId;
  const all = await Service.find({ businessId: bid }).lean();
  const hits = all.filter((s) => nameMatches(s.name));
  console.log(`Business ${bid} (${biz.name}): ${hits.length} matching services`);
  for (const s of hits) {
    console.log(`  - ${s.serviceId}: ${s.name} (active=${s.active})`);
    await Service.updateOne({ _id: s._id }, { $set: { active: false } });
  }
  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

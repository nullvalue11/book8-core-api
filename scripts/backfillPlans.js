#!/usr/bin/env node
/**
 * Set plan=growth on businesses that have no plan field (legacy installs).
 *
 *   MONGODB_URI="..." node scripts/backfillPlans.js
 *   MONGODB_URI="..." node scripts/backfillPlans.js --dry-run
 */
import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dryRun = process.argv.includes("--dry-run");

async function backfill() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.db.collection("businesses");

  const filter = { plan: { $exists: false } };
  const count = await col.countDocuments(filter);
  console.log(`Found ${count} businesses without a plan field (dryRun=${dryRun})`);

  if (dryRun) {
    const sample = await col.find(filter).limit(20).project({ name: 1, id: 1 }).toArray();
    for (const biz of sample) {
      console.log(`  would set plan=growth: ${biz.name || biz.id || biz._id}`);
    }
    await mongoose.disconnect();
    return;
  }

  const result = await col.updateMany(filter, { $set: { plan: "growth" } });
  console.log(`Updated: matched=${result.matchedCount}, modified=${result.modifiedCount}`);

  await mongoose.disconnect();
  console.log("Done");
}

backfill().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

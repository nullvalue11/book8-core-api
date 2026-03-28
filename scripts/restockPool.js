#!/usr/bin/env node
/**
 * Restock specific numbers into Twilio pool as available.
 *
 * Usage:
 *   node scripts/restockPool.js
 *
 * Env:
 *   MONGODB_URI or MONGO_URI (required)
 */
import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const POOL_NUMBERS = ["+15064048251", "+15795011441", "+14382561566"];

async function main() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const twilioCol = db.collection("twilionumbers");

  console.log("[restockPool] Connected to MongoDB");
  console.log("[restockPool] Target numbers:", POOL_NUMBERS.join(", "));

  const existing = await twilioCol
    .find({ phoneNumber: { $in: POOL_NUMBERS } })
    .project({ _id: 0, phoneNumber: 1, status: 1, assignedToBusinessId: 1, assignedAt: 1 })
    .toArray();

  const existingSet = new Set(existing.map((d) => d.phoneNumber));
  const toInsert = POOL_NUMBERS.filter((n) => !existingSet.has(n));
  const skipped = POOL_NUMBERS.filter((n) => existingSet.has(n));

  const now = new Date();
  if (toInsert.length > 0) {
    const docs = toInsert.map((phoneNumber) => ({
      phoneNumber,
      status: "available",
      assignedToBusinessId: null,
      assignedAt: null,
      capabilities: { voice: true, sms: true },
      createdAt: now,
      updatedAt: now
    }));
    await twilioCol.insertMany(docs, { ordered: true });
  }

  console.log("\n[restockPool] Inserted:", toInsert.length ? toInsert : "none");
  console.log("[restockPool] Skipped (already exists):", skipped.length ? skipped : "none");

  const fullPool = await twilioCol
    .find({})
    .project({
      _id: 0,
      phoneNumber: 1,
      status: 1,
      assignedToBusinessId: 1,
      assignedAt: 1
    })
    .sort({ phoneNumber: 1 })
    .toArray();

  console.log("\n[restockPool] Full pool status");
  console.log(JSON.stringify(fullPool, null, 2));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[restockPool] Error:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

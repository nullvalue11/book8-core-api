#!/usr/bin/env node
/**
 * Migration: Add `businessId` field to all business records that only have `id`
 *
 * Run: node scripts/migrateIdToBusinessId.js
 *
 * Uses MONGODB_URI / MONGO_URI (same DB as core-api).
 * Does NOT remove `id` — adds `businessId` as a copy for transition.
 */
import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function migrate() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const collection = db.collection("businesses");

  const docs = await collection
    .find({
      id: { $exists: true },
      businessId: { $exists: false }
    })
    .toArray();

  console.log(`Found ${docs.length} businesses with 'id' but no 'businessId'`);

  for (const doc of docs) {
    await collection.updateOne({ _id: doc._id }, { $set: { businessId: doc.id } });
    console.log(`  Migrated: ${doc.id} → businessId: ${doc.id} (name: ${doc.name || ""})`);
  }

  const reverse = await collection
    .find({
      businessId: { $exists: true },
      id: { $exists: false }
    })
    .toArray();

  if (reverse.length > 0) {
    console.log(`\nWARNING: Found ${reverse.length} businesses with 'businessId' but no 'id'`);
    for (const doc of reverse) {
      await collection.updateOne({ _id: doc._id }, { $set: { id: doc.businessId } });
      console.log(`  Back-filled: ${doc.businessId} → id: ${doc.businessId}`);
    }
  }

  const mismatches = await collection
    .find({
      id: { $exists: true },
      businessId: { $exists: true },
      $expr: { $ne: ["$id", "$businessId"] }
    })
    .toArray();

  if (mismatches.length > 0) {
    console.log(`\nCRITICAL: ${mismatches.length} businesses have MISMATCHED id vs businessId:`);
    for (const doc of mismatches) {
      console.log(
        `  _id: ${doc._id}, id: ${doc.id}, businessId: ${doc.businessId}, name: ${doc.name || ""}`
      );
    }
  }

  console.log("\nMigration complete.");
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

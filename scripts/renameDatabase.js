#!/usr/bin/env node
/**
 * Copies all collections from SOURCE_DB to TARGET_DB (default: test → book8_core).
 *
 * Run: node scripts/renameDatabase.js
 *
 * IMPORTANT:
 * - Run during a maintenance window (no active calls/bookings)
 * - Verify TARGET_DB has all data before switching MONGODB_URI
 * - Keep source DB as backup before dropping
 *
 * Env:
 *   MONGODB_URI or MONGO_URI  (cluster connection string)
 *   SOURCE_DB                 (optional, default test)
 *   TARGET_DB                 (optional, default book8_core)
 */
import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const SOURCE_DB = process.env.SOURCE_DB || "test";
const TARGET_DB = process.env.TARGET_DB || "book8_core";

async function copyDatabase() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();

  const sourceDb = client.db(SOURCE_DB);
  const targetDb = client.db(TARGET_DB);

  const collections = await sourceDb.listCollections().toArray();
  console.log(`Found ${collections.length} collections in '${SOURCE_DB}' database`);

  for (const col of collections) {
    const name = col.name;
    if (name.startsWith("system.")) continue;

    const cursor = sourceDb.collection(name).find({});
    const docs = await cursor.toArray();
    console.log(`  ${name}: ${docs.length} documents`);

    if (docs.length === 0) continue;

    await targetDb.collection(name).insertMany(docs, { ordered: false });
    console.log(`    → Copied to ${TARGET_DB}.${name}`);
  }

  console.log("\nDone. Next steps:");
  console.log(`1. Verify data in ${TARGET_DB}`);
  console.log(`2. Update MONGODB_URI to use database name ${TARGET_DB}`);
  console.log("3. Redeploy core-api");
  console.log("4. Test GET /api/health/all");
  console.log(`5. After verification, you may drop '${SOURCE_DB}' (keep backup first)`);

  await client.close();
}

copyDatabase().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

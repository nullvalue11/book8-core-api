#!/usr/bin/env node
/**
 * Demo / ops: delete all MongoDB bookings for every business in the target database
 * (default `book8_core`; override with DB_NAME / MONGODB_DB_NAME).
 *
 * Matches booking.businessId against each business document's `id` and `businessId`.
 *
 * Does NOT remove Google Calendar / Outlook events — only the `bookings` collection.
 * Does NOT touch databases other than the one selected by env.
 *
 * Usage:
 *   node scripts/purgeBookingsAllBusinesses.js
 *   node scripts/purgeBookingsAllBusinesses.js --dry-run
 *
 * Env:
 *   MONGODB_URI or MONGO_URI     (required)
 *   DB_NAME or MONGODB_DB_NAME   (optional; default book8_core)
 */
import "dotenv/config";
import mongoose from "mongoose";

const DB_NAME =
  process.env.DB_NAME || process.env.MONGODB_DB_NAME || "book8_core";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dryRun = process.argv.includes("--dry-run") || process.env.PURGE_DRY_RUN === "1";

async function main() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  if (dryRun) {
    console.log("[purge-bookings] DRY RUN — no documents will be deleted.\n");
  } else {
    console.log(`[purge-bookings] Deleting bookings from database: ${DB_NAME}\n`);
  }

  try {
    await mongoose.connect(uri, { dbName: DB_NAME });
    const db = mongoose.connection.db;
    const bizCol = db.collection("businesses");
    const bookCol = db.collection("bookings");

    const businesses = await bizCol.find({}).project({ id: 1, businessId: 1 }).toArray();
    const ids = new Set();
    for (const b of businesses) {
      if (b.id) ids.add(String(b.id));
      if (b.businessId) ids.add(String(b.businessId));
    }
    const idList = [...ids];

    const match = idList.length > 0 ? { businessId: { $in: idList } } : null;
    const wouldDelete = match ? await bookCol.countDocuments(match) : 0;

    let deletedCount = 0;
    if (match && !dryRun) {
      const result = await bookCol.deleteMany(match);
      deletedCount = result.deletedCount;
    }

    console.log(
      JSON.stringify(
        {
          database: DB_NAME,
          dryRun,
          businessesScanned: businesses.length,
          distinctBusinessKeys: idList.length,
          bookingsMatched: wouldDelete,
          bookingsDeleted: dryRun ? 0 : deletedCount
        },
        null,
        2
      )
    );

    await mongoose.disconnect();
    console.log(dryRun ? "\nDry run done." : "\nDone.");
  } catch (err) {
    console.error("[purge-bookings] Error:", err.message);
    process.exit(1);
  }
}

await main();

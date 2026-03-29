#!/usr/bin/env node
/**
 * Book8 — Database purge (keep Downtown Barber) + copy test → book8-core
 *
 * 1. In SOURCE_DB (default `test`): purge all businesses except biz_mmpsyemadcrxuc
 * 2. Delete related bookings, SMS conversations, services, schedules for purged IDs
 * 3. Release Twilio pool numbers except +16477882883 (Downtown Barber)
 * 4. Copy all collections from SOURCE_DB to TARGET_DB (default `book8-core`)
 * 5. Does NOT drop SOURCE_DB — drop manually in Atlas after verification
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://.../test?..." node scripts/purgeAndRename.js --dry-run
 *   MONGODB_URI="mongodb+srv://.../test?..." node scripts/purgeAndRename.js
 *
 * Env:
 *   MONGODB_URI or MONGO_URI  (cluster URI; may include /test or not)
 *   SOURCE_DB                 (optional, default test)
 *   TARGET_DB                 (optional, default book8-core)
 */
import "dotenv/config";
import { MongoClient } from "mongodb";

const KEEP_BUSINESS_ID = "biz_mmpsyemadcrxuc";
const KEEP_PHONE = "+16477882883";
const SOURCE_DB = process.env.SOURCE_DB || "test";
const TARGET_DB = process.env.TARGET_DB || "book8-core";

const dryRun = process.argv.includes("--dry-run");

/** Cluster connection string without database name (keep query string). */
function clusterUri(uri) {
  return uri.replace(/\/[^/?]+(\?|$)/, "/$1");
}

function canonicalBusinessId(doc) {
  return doc?.id || doc?.businessId || null;
}

function buildPurgeIdSet(toDelete) {
  const set = new Set();
  for (const b of toDelete) {
    if (b.id) set.add(String(b.id));
    if (b.businessId) set.add(String(b.businessId));
  }
  return [...set];
}

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("ERROR: Set MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  const client = new MongoClient(clusterUri(uri));
  await client.connect();
  console.log("Connected to MongoDB cluster");
  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE (will modify data)"}`);
  console.log(`Source DB: ${SOURCE_DB}`);
  console.log(`Target DB: ${TARGET_DB}`);
  console.log(`Keeping business: ${KEEP_BUSINESS_ID} (Downtown Barber)`);
  console.log(`Keeping phone: ${KEEP_PHONE}`);
  console.log("---");

  const sourceDb = client.db(SOURCE_DB);

  // ════════════════════════════════════════
  // PHASE 1: PURGE
  // ════════════════════════════════════════
  console.log("\n=== PHASE 1: PURGE ===\n");

  const allBusinesses = await sourceDb.collection("businesses").find({}).toArray();
  const toDelete = allBusinesses.filter((b) => canonicalBusinessId(b) !== KEEP_BUSINESS_ID);
  const toKeep = allBusinesses.filter((b) => canonicalBusinessId(b) === KEEP_BUSINESS_ID);

  console.log(`Total businesses: ${allBusinesses.length}`);
  console.log(
    `Keeping: ${toKeep.length} (${toKeep.map((b) => `${b.name || "unnamed"} [${canonicalBusinessId(b)}]`).join(", ") || "none"})`
  );
  console.log(`Deleting: ${toDelete.length}`);
  toDelete.forEach((b) => {
    console.log(`  - ${b.name || "unnamed"} [${canonicalBusinessId(b)}]`);
  });

  const purgeIds = buildPurgeIdSet(toDelete);

  if (purgeIds.length === 0 && toDelete.length > 0) {
    console.warn("Warning: purge ID list empty but businesses marked for delete — check id/businessId fields.");
  }

  const bookingFilter =
    purgeIds.length > 0
      ? {
          $or: [{ businessId: { $in: purgeIds } }, { business: { $in: purgeIds } }]
        }
      : { _id: { $exists: false } };

  const relatedFilter = purgeIds.length > 0 ? { businessId: { $in: purgeIds } } : { _id: { $exists: false } };

  if (!dryRun) {
    if (purgeIds.length > 0) {
      const bookingResult = await sourceDb.collection("bookings").deleteMany(bookingFilter);
      console.log(`\nDeleted ${bookingResult.deletedCount} bookings`);

      let smsDeleted = 0;
      try {
        const r = await sourceDb.collection("smsconversations").deleteMany(relatedFilter);
        smsDeleted = r.deletedCount;
      } catch {
        /* collection may not exist */
      }
      console.log(`Deleted ${smsDeleted} SMS conversation documents (smsconversations)`);

      const serviceResult = await sourceDb.collection("services").deleteMany(relatedFilter);
      console.log(`Deleted ${serviceResult.deletedCount} services`);

      const scheduleResult = await sourceDb.collection("schedules").deleteMany(relatedFilter);
      console.log(`Deleted ${scheduleResult.deletedCount} schedules`);
    }

    const twilioResult = await sourceDb.collection("twilionumbers").updateMany(
      { phoneNumber: { $ne: KEEP_PHONE } },
      {
        $set: {
          status: "available",
          assignedToBusinessId: null,
          assignedAt: null,
          updatedAt: new Date()
        },
        $unset: {
          assignedTo: "",
          businessId: ""
        }
      }
    );
    console.log(`\nReleased ${twilioResult.modifiedCount} Twilio numbers (non–Downtown Barber)`);

    const bizResult = await sourceDb.collection("businesses").deleteMany({
      $nor: [{ id: KEEP_BUSINESS_ID }, { businessId: KEEP_BUSINESS_ID }]
    });
    console.log(`Deleted ${bizResult.deletedCount} business records`);
  } else if (dryRun) {
    const bookingCount =
      purgeIds.length > 0
        ? await sourceDb.collection("bookings").countDocuments(bookingFilter)
        : 0;
    let smsCount = 0;
    for (const collName of ["smsconversations"]) {
      try {
        smsCount += await sourceDb.collection(collName).countDocuments(relatedFilter);
      } catch {
        /* noop */
      }
    }
    const serviceCount =
      purgeIds.length > 0 ? await sourceDb.collection("services").countDocuments(relatedFilter) : 0;
    const scheduleCount =
      purgeIds.length > 0 ? await sourceDb.collection("schedules").countDocuments(relatedFilter) : 0;
    const twilioCount = await sourceDb.collection("twilionumbers").countDocuments({
      phoneNumber: { $ne: KEEP_PHONE }
    });

    console.log(`\nWould delete ${bookingCount} bookings`);
    console.log(`Would delete ${smsCount} SMS conversations (smsconversations)`);
    console.log(`Would delete ${serviceCount} services`);
    console.log(`Would delete ${scheduleCount} schedules`);
    console.log(`Would update ${twilioCount} Twilio numbers to available (except ${KEEP_PHONE})`);
    console.log(`Would delete ${toDelete.length} business records`);
  }

  // ════════════════════════════════════════
  // PHASE 2: COPY source → target
  // ════════════════════════════════════════
  console.log("\n=== PHASE 2: COPY TO TARGET ===\n");

  const targetDb = client.db(TARGET_DB);
  const collections = await sourceDb.listCollections().toArray();
  console.log(`Found ${collections.length} collections in '${SOURCE_DB}'`);

  for (const col of collections) {
    const name = col.name;
    if (name.startsWith("system.")) continue;

    const docs = await sourceDb.collection(name).find({}).toArray();
    console.log(`  ${name}: ${docs.length} documents`);

    if (!dryRun && docs.length > 0) {
      try {
        await targetDb.collection(name).drop();
      } catch {
        /* did not exist */
      }
      await targetDb.collection(name).insertMany(docs, { ordered: false });
      console.log(`    → Copied to ${TARGET_DB}.${name}`);
    } else if (dryRun && docs.length > 0) {
      console.log(`    → Would copy ${docs.length} docs to ${TARGET_DB}.${name}`);
    }
  }

  // ════════════════════════════════════════
  // PHASE 3: VERIFY
  // ════════════════════════════════════════
  console.log("\n=== PHASE 3: VERIFY ===\n");

  if (!dryRun) {
    const barber = await targetDb.collection("businesses").findOne({
      $or: [{ id: KEEP_BUSINESS_ID }, { businessId: KEEP_BUSINESS_ID }]
    });
    console.log(`Downtown Barber in ${TARGET_DB}: ${barber ? "FOUND" : "MISSING"}`);
    if (barber) {
      console.log(`  Name: ${barber.name}`);
      console.log(`  Handle: ${barber.handle ?? "(not set)"}`);
      console.log(
        `  Phone: ${barber.assignedTwilioNumber || barber.twilioPhoneNumber || barber.phoneNumber || "not set"}`
      );
    }

    const bizCount = await targetDb.collection("businesses").countDocuments({});
    console.log(`\nTotal businesses in ${TARGET_DB}: ${bizCount}`);

    try {
      const pool = await targetDb.collection("twilionumbers").find({}).sort({ phoneNumber: 1 }).toArray();
      console.log(`\nTwilio pool in ${TARGET_DB}:`);
      for (const n of pool) {
        const assign = n.assignedToBusinessId ? ` → ${n.assignedToBusinessId}` : "";
        console.log(`  ${n.phoneNumber} — ${n.status}${assign}`);
      }
    } catch {
      console.log("(no twilionumbers collection)");
    }
  } else {
    console.log("Dry run — skip verification writes.");
  }

  // ════════════════════════════════════════
  // NEXT STEPS
  // ════════════════════════════════════════
  console.log("\n=== NEXT STEPS ===\n");
  console.log("1. Verify output above.");
  console.log(`2. Point Render MONGODB_URI at .../${TARGET_DB}?... (or keep using ${SOURCE_DB} until cutover).`);
  console.log("3. Redeploy book8-core-api if env changed.");
  console.log("4. GET /api/health/all — expect Downtown Barber READY.");
  console.log(`5. After a backup period, drop '${SOURCE_DB}' in Atlas if desired.`);

  await client.close();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});

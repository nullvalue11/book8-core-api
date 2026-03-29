#!/usr/bin/env node
/**
 * Purge core-api MongoDB: keep Downtown Barber only; delete other businesses and related data.
 *
 *   MONGODB_URI="mongodb+srv://.../any?..." DB_NAME=book8-core node scripts/purgeNamed.js --dry-run
 *   MONGODB_URI="..." DB_NAME=book8-core node scripts/purgeNamed.js
 *
 * Env: MONGODB_URI or MONGO_URI (required), DB_NAME (default book8-core)
 */
import "dotenv/config";
import { MongoClient } from "mongodb";

const KEEP_BUSINESS_ID = "biz_mmpsyemadcrxuc";
const KEEP_PHONE = "+16477882883";
const DB_NAME = process.env.DB_NAME || "book8-core";
const dryRun = process.argv.includes("--dry-run");

function clusterUri(uri) {
  return String(uri || "").replace(/\/[^/?]+(\?|$)/, "/$1");
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
  const db = client.db(DB_NAME);

  console.log(`Connected — database: ${DB_NAME}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Keeping: ${KEEP_BUSINESS_ID} (Downtown Barber)`);
  console.log("---");

  const allBusinesses = await db.collection("businesses").find({}).toArray();
  const toDelete = allBusinesses.filter((b) => canonicalBusinessId(b) !== KEEP_BUSINESS_ID);
  const toKeep = allBusinesses.filter((b) => canonicalBusinessId(b) === KEEP_BUSINESS_ID);

  console.log(`Total businesses: ${allBusinesses.length}`);
  toKeep.forEach((b) =>
    console.log(`  KEEP: ${b.name || "unnamed"} [${canonicalBusinessId(b)}]`)
  );
  console.log(`Deleting: ${toDelete.length}`);
  toDelete.forEach((b) =>
    console.log(`  DEL:  ${b.name || "unnamed"} [${canonicalBusinessId(b)}]`)
  );

  const purgeIds = buildPurgeIdSet(toDelete);
  const bookingFilter =
    purgeIds.length > 0
      ? { $or: [{ businessId: { $in: purgeIds } }, { business: { $in: purgeIds } }] }
      : { _id: { $exists: false } };
  const relatedFilter =
    purgeIds.length > 0 ? { businessId: { $in: purgeIds } } : { _id: { $exists: false } };

  if (dryRun) {
    const bookingCount =
      purgeIds.length > 0 ? await db.collection("bookings").countDocuments(bookingFilter) : 0;
    let smsCount = 0;
    try {
      smsCount = await db.collection("smsconversations").countDocuments(relatedFilter);
    } catch {
      /* no collection */
    }
    const serviceCount =
      purgeIds.length > 0 ? await db.collection("services").countDocuments(relatedFilter) : 0;
    const scheduleCount =
      purgeIds.length > 0 ? await db.collection("schedules").countDocuments(relatedFilter) : 0;
    let twilioCount = 0;
    try {
      twilioCount = await db.collection("twilionumbers").countDocuments({
        phoneNumber: { $ne: KEEP_PHONE }
      });
    } catch {
      /* */
    }
    console.log(`\nWould delete ${bookingCount} bookings, ${smsCount} smsconversations, ${serviceCount} services, ${scheduleCount} schedules`);
    console.log(`Would release ${twilioCount} Twilio pool rows (not ${KEEP_PHONE})`);
    console.log(`Would delete ${toDelete.length} businesses`);
  } else if (purgeIds.length > 0) {
    const bookingResult = await db.collection("bookings").deleteMany(bookingFilter);
    console.log(`\nDeleted ${bookingResult.deletedCount} bookings`);

    let smsDeleted = 0;
    try {
      const r = await db.collection("smsconversations").deleteMany(relatedFilter);
      smsDeleted = r.deletedCount;
    } catch {
      /* */
    }
    console.log(`Deleted ${smsDeleted} SMS conversations`);

    const serviceResult = await db.collection("services").deleteMany(relatedFilter);
    console.log(`Deleted ${serviceResult.deletedCount} services`);

    const scheduleResult = await db.collection("schedules").deleteMany(relatedFilter);
    console.log(`Deleted ${scheduleResult.deletedCount} schedules`);

    try {
      const twilioResult = await db.collection("twilionumbers").updateMany(
        { phoneNumber: { $ne: KEEP_PHONE } },
        {
          $set: {
            status: "available",
            assignedToBusinessId: null,
            assignedAt: null,
            updatedAt: new Date()
          },
          $unset: { assignedTo: "", businessId: "" }
        }
      );
      console.log(`Released ${twilioResult.modifiedCount} Twilio numbers`);
    } catch (e) {
      console.warn("twilionumbers:", e.message);
    }

    const bizResult = await db.collection("businesses").deleteMany({
      $nor: [{ id: KEEP_BUSINESS_ID }, { businessId: KEEP_BUSINESS_ID }]
    });
    console.log(`Deleted ${bizResult.deletedCount} businesses`);
  } else {
    console.log("\nNothing to purge (only kept business or empty).");
  }

  console.log("\n=== VERIFY ===");
  const remaining = await db.collection("businesses").find({}).toArray();
  console.log(`Businesses remaining: ${remaining.length}`);
  remaining.forEach((b) =>
    console.log(`  ${b.name || "unnamed"} [${canonicalBusinessId(b)}]`)
  );
  if (remaining.length === 1 && canonicalBusinessId(remaining[0]) === KEEP_BUSINESS_ID) {
    console.log("OK — only Downtown Barber remains.");
  } else if (remaining.length === 0) {
    console.warn("WARNING — no businesses left (expected Downtown Barber).");
  } else {
    console.warn("WARNING — more than one business or wrong id.");
  }

  await client.close();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

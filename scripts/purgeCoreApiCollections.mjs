#!/usr/bin/env node
/**
 * Deletes ALL documents from book8-core-api MongoDB collections only.
 * Safe when MONGODB_URI points at a SHARED database (e.g. "book8" with users/ops from book8-ai):
 * does NOT touch users, ops_*, billing_*, stripe_events, etc.
 *
 * Collections wiped (if present): businesses, bookings, services, schedules,
 * providers, waitlists, reviews, twilionumbers, smsconversations, calls
 *
 * Usage:
 *   node scripts/purgeCoreApiCollections.mjs --dry-run
 *   PURGE_CONFIRM=yes node scripts/purgeCoreApiCollections.mjs
 *
 * Second cluster (e.g. test):
 *   PURGE_CONFIRM=yes MONGODB_URI_TEST=<uri> node scripts/purgeCoreApiCollections.mjs
 *
 * Env: MONGODB_URI or MONGO_URI (required); optional MONGODB_URI_TEST for a second pass in one run.
 */
import "dotenv/config";
import mongoose from "mongoose";

const CORE_COLLECTIONS = [
  "businesses",
  "bookings",
  "services",
  "schedules",
  "providers",
  "waitlists",
  "reviews",
  "twilionumbers",
  "smsconversations",
  "calls",
  "google_events",
  "public_booking_tokens"
];

const dryRun = process.argv.includes("--dry-run");
const confirm = process.env.PURGE_CONFIRM === "yes" || process.env.PURGE_CONFIRM === "true";

const uriPrimary = process.env.MONGODB_URI || process.env.MONGO_URI;
const uriTest = process.env.MONGODB_URI_TEST || process.env.MONGO_URI_TEST || "";

function urisToRun() {
  const out = [];
  if (uriPrimary) out.push({ label: "primary (MONGODB_URI)", uri: uriPrimary });
  if (uriTest) out.push({ label: "test (MONGODB_URI_TEST)", uri: uriTest });
  return out;
}

async function purgeOneDb(uri, label) {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const name = db.databaseName;
  console.log(`\n=== ${label} → database "${name}" ===`);

  const existing = (await db.listCollections().toArray()).map((c) => c.name);
  const toClear = CORE_COLLECTIONS.filter((c) => existing.includes(c));
  const skipped = CORE_COLLECTIONS.filter((c) => !existing.includes(c));

  const report = [];
  for (const col of toClear) {
    const before = await db.collection(col).countDocuments();
    report.push({ collection: col, deleted: before });
    if (!dryRun && confirm && before > 0) {
      await db.collection(col).deleteMany({});
    }
  }

  console.log(
    JSON.stringify(
      {
        database: name,
        dryRun,
        cleared: report,
        missingCollections: skipped
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

async function main() {
  const list = urisToRun();
  if (list.length === 0) {
    console.error("Set MONGODB_URI or MONGO_URI.");
    process.exit(1);
  }

  if (!dryRun && !confirm) {
    console.error(
      "Refusing. Run:\n" +
        "  node scripts/purgeCoreApiCollections.mjs --dry-run\n" +
        "  PURGE_CONFIRM=yes node scripts/purgeCoreApiCollections.mjs"
    );
    process.exit(1);
  }

  console.log(
    dryRun
      ? "[purge-core] DRY RUN — no deletes.\n"
      : "[purge-core] PURGE_CONFIRM=yes — deleting core-api documents only (not users/ops).\n"
  );

  for (const { label, uri } of list) {
    await purgeOneDb(uri, label);
  }

  console.log(dryRun ? "\nDry run done." : "\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

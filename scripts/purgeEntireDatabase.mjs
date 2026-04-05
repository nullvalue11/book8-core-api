#!/usr/bin/env node
/**
 * DANGER: Drops ALL collections in the database(s) by calling dropDatabase().
 * Use for wiping dev/test or when you intentionally empty production.
 *
 * Usage:
 *   node scripts/purgeEntireDatabase.mjs --dry-run
 *     → lists DB name, collections, and approximate counts (no deletes).
 *
 *   PURGE_CONFIRM=yes node scripts/purgeEntireDatabase.mjs
 *     → drops the database pointed to by MONGODB_URI or MONGO_URI (.env).
 *
 * To wipe a second cluster (e.g. test vs prod), set MONGODB_URI_TEST and run again,
 * or set both in one run:
 *   PURGE_CONFIRM=yes MONGODB_URI="mongodb+srv://.../prod" MONGODB_URI_TEST="mongodb+srv://.../test" node scripts/purgeEntireDatabase.mjs
 *
 * Atlas note: user must have readWrite + dropDatabase permission (dbOwner or atlasAdmin on that DB).
 */
import "dotenv/config";
import mongoose from "mongoose";

const dryRun = process.argv.includes("--dry-run");
const confirm = process.env.PURGE_CONFIRM === "yes" || process.env.PURGE_CONFIRM === "true";

const uriPrimary = process.env.MONGODB_URI || process.env.MONGO_URI;
const uriTest = process.env.MONGODB_URI_TEST || process.env.MONGO_URI_TEST || "";

function collectUris() {
  const out = [];
  if (uriPrimary) out.push({ label: "MONGODB_URI/MONGO_URI", uri: uriPrimary });
  if (uriTest) out.push({ label: "MONGODB_URI_TEST/MONGO_URI_TEST", uri: uriTest });
  return out;
}

async function inspectAndMaybeDrop(uri, label) {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const name = db.databaseName;
  const cols = await db.listCollections().toArray();
  const summary = [];
  for (const c of cols) {
    const n = await db.collection(c.name).estimatedDocumentCount();
    summary.push({ collection: c.name, approxCount: n });
  }
  console.log(`\n=== ${label} → database "${name}" ===`);
  console.log(JSON.stringify({ database: name, collections: summary }, null, 2));

  if (dryRun) {
    await mongoose.disconnect();
    return;
  }

  if (!confirm) {
    console.error(`[purge] Refusing to drop "${name}" without PURGE_CONFIRM=yes`);
    await mongoose.disconnect();
    process.exit(1);
  }

  await db.dropDatabase();
  console.log(`[purge] Dropped database "${name}" OK.`);
  await mongoose.disconnect();
}

async function main() {
  const uris = collectUris();
  if (uris.length === 0) {
    console.error("Set MONGODB_URI or MONGO_URI (and optionally MONGODB_URI_TEST for a second DB).");
    process.exit(1);
  }

  if (!dryRun && !confirm) {
    console.error(
      "Refusing to run destructive purge. Use:\n" +
        "  node scripts/purgeEntireDatabase.mjs --dry-run\n" +
        "or:\n" +
        "  PURGE_CONFIRM=yes node scripts/purgeEntireDatabase.mjs"
    );
    process.exit(1);
  }

  console.log(
    dryRun
      ? "[purge] DRY RUN — no data will be deleted.\n"
      : "[purge] PURGE_CONFIRM=yes — dropping entire database(s).\n"
  );

  for (const { label, uri } of uris) {
    await inspectAndMaybeDrop(uri, label);
  }

  console.log(dryRun ? "\nDry run finished." : "\nAll requested databases dropped.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

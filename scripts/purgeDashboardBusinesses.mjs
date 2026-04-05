#!/usr/bin/env node
/**
 * Clears ONLY the `businesses` collection on the dashboard database (`book8` on Vercel).
 * Does not touch users, ops_*, billing_*, or any other collections — needed for E2E so
 * book8.io redirects to /setup when no businesses exist (BOO-56 / BOO-47B).
 *
 * Env (first match wins):
 *   MONGO_URL           — Vercel dashboard (typical)
 *   MONGODB_URI_BOOK8   — same DB, explicit name (see purgeSignupByEmailFull.mjs)
 *
 * Usage:
 *   MONGO_URL="mongodb+srv://.../book8?..." node scripts/purgeDashboardBusinesses.mjs --dry-run
 *   PURGE_CONFIRM=yes MONGO_URL="..." node scripts/purgeDashboardBusinesses.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";

const dryRun = process.argv.includes("--dry-run");
const confirm = process.env.PURGE_CONFIRM === "yes" || process.env.PURGE_CONFIRM === "true";

const uri =
  process.env.MONGO_URL ||
  process.env.MONGODB_URI_BOOK8 ||
  "";

function dbNameFromUri(u) {
  try {
    const pathname = new URL(u.replace(/^mongodb\+srv:/, "https:")).pathname;
    const seg = pathname.replace(/^\//, "").split("/")[0];
    return seg?.split("?")[0] || "";
  } catch {
    return "";
  }
}

async function main() {
  if (!uri) {
    console.error(
      "Set MONGO_URL (Vercel dashboard) or MONGODB_URI_BOOK8 pointing at the book8 database."
    );
    process.exit(1);
  }

  if (!dryRun && !confirm) {
    console.error(
      "Refusing. Run:\n" +
        "  MONGO_URL=... node scripts/purgeDashboardBusinesses.mjs --dry-run\n" +
        "  PURGE_CONFIRM=yes MONGO_URL=... node scripts/purgeDashboardBusinesses.mjs"
    );
    process.exit(1);
  }

  const expectedName = dbNameFromUri(uri);
  if (expectedName && expectedName !== "book8") {
    console.warn(
      `[purge-dashboard-businesses] Warning: URI path database is "${expectedName}", expected "book8" for dashboard.`
    );
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const name = db.databaseName;

  const coll = "businesses";
  const exists = (await db.listCollections({ name: coll }).toArray()).length > 0;
  const before = exists ? await db.collection(coll).countDocuments() : 0;

  const sample = exists
    ? await db
        .collection(coll)
        .find({}, { projection: { name: 1, businessProfile: 1 } })
        .limit(20)
        .toArray()
    : [];

  console.log(
    JSON.stringify(
      {
        database: name,
        dryRun,
        collection: coll,
        exists,
        countBefore: before,
        sampleNames: sample.map((d) => d.name || d.businessProfile?.businessName || d._id)
      },
      null,
      2
    )
  );

  if (!dryRun && confirm && exists && before > 0) {
    const r = await db.collection(coll).deleteMany({});
    console.log(JSON.stringify({ deleted: r.deletedCount }, null, 2));
  }

  await mongoose.disconnect();
  console.log(dryRun ? "Dry run done." : "Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * BOO-117: Copy calendar state from book8 (dashboard) DB into book8-core businesses.
 *
 * Usage:
 *   node scripts/backfill-calendar-state-from-book8.cjs           # dry-run (default)
 *   node scripts/backfill-calendar-state-from-book8.cjs --apply   # write
 *
 * Env:
 *   MONGODB_URI                 — default connection (required if MONGODB_CORE_URI unset)
 *   MONGODB_CORE_URI            — optional; target `book8-core` DB. Use when MONGODB_URI is `.../book8` locally
 *   MONGODB_BOOK8_URI           — full URI for the dashboard `book8` source database (highest priority)
 *   MONGODB_BOOK8_DATABASE      — e.g. `book8` — only the DB name is swapped (same host as the *core* URI)
 *   If the core URI path is `/book8-core` and no BOOK8 vars, the script uses `/book8` as the source.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

function parseMongoDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") return null;
  const m = uri.match(/^(.+\/)([^/?]+)(\?.*)?$/);
  if (!m) return null;
  return { base: m[1], dbName: m[2], query: m[3] || "" };
}

/** Resolve book8 (dashboard) URI from env or from MONGODB_URI. */
function resolveBook8Uri(coreUri) {
  if (process.env.MONGODB_BOOK8_URI) {
    return process.env.MONGODB_BOOK8_URI;
  }
  const parts = parseMongoDatabaseUri(coreUri);
  if (!parts) return null;
  const { base, dbName, query } = parts;
  const overrideDb = process.env.MONGODB_BOOK8_DATABASE;
  if (overrideDb && String(overrideDb).trim()) {
    return `${base}${String(overrideDb).trim()}${query}`;
  }
  if (dbName === "book8-core") {
    return `${base}book8${query}`;
  }
  return null;
}

function snapshotCalState(doc) {
  const c = (doc && doc.calendar) || {};
  const iso = (v) => {
    if (v == null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return JSON.stringify({
    calendarProvider: doc.calendarProvider ?? null,
    connected: !!c.connected,
    provider: c.provider ?? null,
    connectedAt: iso(c.connectedAt),
    calendarId: c.calendarId ?? null,
    lastSyncedAt: iso(c.lastSyncedAt)
  });
}

(async () => {
  const coreUri = process.env.MONGODB_CORE_URI || process.env.MONGODB_URI;
  if (!coreUri) {
    console.error("[backfill-calendar] MONGODB_URI (or MONGODB_CORE_URI) is required");
    process.exit(1);
  }
  const book8Uri = process.env.MONGODB_BOOK8_URI || resolveBook8Uri(coreUri);
  if (!book8Uri) {
    const parts = parseMongoDatabaseUri(coreUri);
    console.error("[backfill-calendar] Could not determine the book8 (dashboard) **source** database URI.");
    console.error("  This script reads businesses from `book8` and writes calendar fields to `book8-core`.");
    console.error("  Set one of:");
    console.error("    MONGODB_BOOK8_URI=<full connection string to the `book8` database>");
    console.error("    MONGODB_BOOK8_DATABASE=book8   (same cluster as the core URI, swap only the DB name)");
    console.error("  Or use a core URI whose path ends with /book8-core (script then uses /book8).");
    console.error("  If your MONGODB_URI is already .../book8, set MONGODB_CORE_URI to the book8-core URI, or set");
    console.error("    MONGODB_BOOK8_URI to the same `book8` string you use for the dashboard (source).");
    if (parts) {
      console.error("  Core connection database name in use is:", JSON.stringify(parts.dbName));
    }
    process.exit(1);
  }

  const { buildCalendarSyncUpdate } = await import("../src/utils/calendarSyncPayload.js");

  const coreConn = await mongoose.createConnection(coreUri).asPromise();
  const book8Conn = await mongoose.createConnection(book8Uri).asPromise();

  const coreColl = coreConn.db.collection("businesses");
  const book8Coll = book8Conn.db.collection("businesses");

  console.log("[backfill-calendar] core DB:", coreConn.db.databaseName);
  console.log("[backfill-calendar] book8 DB:", book8Conn.db.databaseName);
  console.log("[backfill-calendar] mode:", APPLY ? "APPLY" : "DRY-RUN");

  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let skippedNoBook8 = 0;
  let skippedSame = 0;

  const cursor = coreColl.find({});
  while (await cursor.hasNext()) {
    const coreDoc = await cursor.next();
    scanned++;
    const bid = coreDoc.id || coreDoc.businessId;
    if (!bid) continue;

    const book8Doc = await book8Coll.findOne({
      $or: [{ id: bid }, { businessId: bid }]
    });
    if (!book8Doc) {
      skippedNoBook8++;
      continue;
    }

    if (snapshotCalState(coreDoc) === snapshotCalState(book8Doc)) {
      skippedSame++;
      continue;
    }

    wouldUpdate++;
    const bc = book8Doc.calendar;
    const calendarPayload = {
      connected: bc ? !!bc.connected : false,
      provider: bc && bc.provider != null ? bc.provider : null,
      connectedAt: bc && bc.connectedAt != null ? bc.connectedAt : null,
      calendarId: bc && bc.calendarId != null ? bc.calendarId : null,
      lastSyncedAt: bc && bc.lastSyncedAt != null ? bc.lastSyncedAt : null
    };
    const $set = buildCalendarSyncUpdate({
      calendar: calendarPayload,
      calendarProvider: book8Doc.calendarProvider !== undefined ? book8Doc.calendarProvider : null
    });

    console.log("[backfill-calendar] would sync", bid, {
      fromBook8: { calendar: calendarPayload, calendarProvider: book8Doc.calendarProvider ?? null }
    });

    if (APPLY) {
      await coreColl.updateOne({ _id: coreDoc._id }, { $set });
      updated++;
    }
  }

  await coreConn.close();
  await book8Conn.close();

  console.log("[backfill-calendar] done", {
    scanned,
    wouldUpdate,
    updated: APPLY ? updated : 0,
    skippedNoBook8,
    skippedSame
  });
  process.exit(0);
})().catch((e) => {
  console.error("[backfill-calendar] fatal:", e);
  process.exit(1);
});

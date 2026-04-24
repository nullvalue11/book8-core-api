/**
 * BOO-117: Copy calendar state from book8 (dashboard) DB into book8-core businesses.
 *
 * Usage:
 *   node scripts/backfill-calendar-state-from-book8.cjs           # dry-run (default)
 *   node scripts/backfill-calendar-state-from-book8.cjs --apply   # write
 *
 * Env:
 *   MONGODB_URI        — book8-core connection string (required)
 *   MONGODB_BOOK8_URI  — book8 dashboard DB; if omitted, "book8-core" in URI is replaced with "book8"
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

function deriveBook8Uri(coreUri) {
  if (!coreUri || typeof coreUri !== "string") return null;
  const m = coreUri.match(/^(.+\/)([^/?]+)(\?.*)?$/);
  if (!m) return null;
  const [, base, dbName, query = ""] = m;
  if (dbName !== "book8-core") return null;
  return `${base}book8${query}`;
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
  const coreUri = process.env.MONGODB_URI;
  if (!coreUri) {
    console.error("[backfill-calendar] MONGODB_URI is required");
    process.exit(1);
  }
  const book8Uri = process.env.MONGODB_BOOK8_URI || deriveBook8Uri(coreUri);
  if (!book8Uri) {
    console.error(
      "[backfill-calendar] Set MONGODB_BOOK8_URI or use a MONGODB_URI containing book8-core so book8 can be derived"
    );
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

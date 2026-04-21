/**
 * BOO-107A: one-time fix — naïve wall times were stored as if UTC. Re-interpret stored ISO wall
 * digits in slot.timezone and write correct UTC instants. Idempotent via slot.tzFixed.
 *
 * Usage:
 *   node scripts/migrate-booking-slot-tz.cjs           # dry-run (default)
 *   node scripts/migrate-booking-slot-tz.cjs --apply   # write
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { DateTime } = require("luxon");

const APPLY = process.argv.includes("--apply");

function toDate(v) {
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error("[migrate] MONGODB_URI is required");
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI.replace(/\/book8(\?|$)/, "/book8-core$1");
  await mongoose.connect(uri);
  console.log("[migrate] Connected to:", mongoose.connection.db.databaseName);
  console.log("[migrate] Mode:", APPLY ? "APPLY" : "DRY-RUN");

  const cursor = mongoose.connection.db.collection("bookings").find({});
  let scanned = 0;
  let wouldMigrate = 0;
  let migrated = 0;
  let skipped = 0;
  let errored = 0;

  while (await cursor.hasNext()) {
    const b = await cursor.next();
    scanned++;
    try {
      if (b.slot?.tzFixed === true) {
        skipped++;
        continue;
      }
      const tz = b.slot?.timezone;
      const oldStartRaw = b.slot?.start;
      const oldEndRaw = b.slot?.end;
      if (!tz || !oldStartRaw || !oldEndRaw) {
        skipped++;
        continue;
      }

      const oldStart = toDate(oldStartRaw);
      const oldEnd = toDate(oldEndRaw);
      if (!oldStart || !oldEnd) {
        skipped++;
        continue;
      }

      const wallStart = oldStart.toISOString().replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
      const wallEnd = oldEnd.toISOString().replace(/\.\d{3}Z$/, "").replace(/Z$/, "");

      const newStart = DateTime.fromISO(wallStart, { zone: tz }).toUTC().toJSDate();
      const newEnd = DateTime.fromISO(wallEnd, { zone: tz }).toUTC().toJSDate();

      if (newStart.getTime() === oldStart.getTime() && newEnd.getTime() === oldEnd.getTime()) {
        skipped++;
        continue;
      }

      wouldMigrate++;
      console.log(
        `  [${b.id || b._id}] start ${oldStart.toISOString()} → ${newStart.toISOString()} (${tz})`
      );

      if (APPLY) {
        await mongoose.connection.db.collection("bookings").updateOne(
          { _id: b._id },
          {
            $set: {
              "slot.start": newStart.toISOString(),
              "slot.end": newEnd.toISOString(),
              "slot.tzFixed": true
            }
          }
        );
        migrated++;
      }
    } catch (err) {
      errored++;
      console.error(`  [${b.id}] ERROR: ${err.message}`);
    }
  }

  console.log("[migrate] Done.", { scanned, wouldMigrate, migrated, skipped, errored });
  await mongoose.disconnect();
  process.exit(0);
})();

#!/usr/bin/env node
/**
 * BOO-97A — Backfill trial.{startedAt,endsAt,graceEndsAt,status} on existing businesses.
 *
 *   npm run backfill:trial:dry
 *   npm run backfill:trial
 */
import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dryRun = process.argv.includes("--dry-run");

const TRIAL_DAYS = 14;
const GRACE_DAYS = 3;

function computeCachedStatus(endsMs, graceMs, nowMs, subscribed) {
  if (subscribed) return "subscribed";
  if (nowMs < endsMs) return "active";
  if (nowMs < graceMs) return "grace";
  return "locked";
}

async function main() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.db.collection("businesses");

  const filter = {
    $or: [{ "trial.startedAt": { $exists: false } }, { "trial.endsAt": { $exists: false } }]
  };
  const total = await col.countDocuments(filter);
  console.log(`[backfill-trial] candidates=${total} dryRun=${dryRun}`);

  const cursor = col.find(filter);
  let n = 0;
  const now = Date.now();

  for await (const doc of cursor) {
    const started = doc.createdAt ? new Date(doc.createdAt) : new Date();
    const endsAt = new Date(started);
    endsAt.setDate(endsAt.getDate() + TRIAL_DAYS);
    const graceEndsAt = new Date(endsAt);
    graceEndsAt.setDate(graceEndsAt.getDate() + GRACE_DAYS);

    const plan = doc.plan ? String(doc.plan).toLowerCase() : "";
    const subscribed = !!(doc.stripeSubscriptionId && plan && plan !== "none");
    const status = computeCachedStatus(
      endsAt.getTime(),
      graceEndsAt.getTime(),
      now,
      subscribed
    );

    const trial = {
      startedAt: started,
      endsAt,
      graceEndsAt,
      status
    };

    const idStr = doc.id || doc.businessId || String(doc._id);
    if (dryRun) {
      console.log(`  [dry-run] ${idStr} → trial.status=${status} endsAt=${endsAt.toISOString()}`);
    } else {
      await col.updateOne(
        { _id: doc._id },
        {
          $set: { trial }
        }
      );
      console.log(`[trial-lifecycle] business=${idStr} backfill status=${status}`);
    }
    n++;
  }

  await mongoose.disconnect();
  console.log(`[backfill-trial] processed=${n} done`);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

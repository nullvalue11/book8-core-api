#!/usr/bin/env node
/**
 * One-off data fixes for critical QA (Issues 1–4 in CURSOR_TASK_FIX_CRITICAL_QA_CORE_API).
 *
 * Run against production:
 *   MONGODB_URI="..." node scripts/fixCriticalQaData.js --dry-run
 *   MONGODB_URI="..." node scripts/fixCriticalQaData.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dryRun = process.argv.includes("--dry-run");

const DOWNTOWN_BARBER = {
  id: "biz_mmpsyemadcrxuc",
  handle: "downtown-barber"
};

const FITNESS_STUDIO = {
  businessId: "biz_mmzusq281oq7pb",
  services: [
    { serviceId: "personal-training-60", name: "Personal Training", durationMinutes: 60 },
    { serviceId: "group-class-45", name: "Group Class", durationMinutes: 45 },
    { serviceId: "assessment-30", name: "Assessment", durationMinutes: 30 }
  ]
};

const NAMES = [
  {
    filter: { $or: [{ id: "biz_mmzusq281oq7pb" }, { businessId: "biz_mmzusq281oq7pb" }] },
    name: "Fitness Studio"
  },
  {
    filter: { $or: [{ id: "biz_mmzzgvsy6tkwtm" }, { businessId: "biz_mmzzgvsy6tkwtm" }] },
    name: "River City Massage"
  }
];

const OTTAWA_DENTAL = {
  businessId: "biz_mmwfgpg50jkiub",
  weeklyHours: {
    monday: [{ start: "09:00", end: "17:00" }],
    tuesday: [{ start: "09:00", end: "17:00" }],
    wednesday: [{ start: "09:00", end: "17:00" }],
    thursday: [{ start: "09:00", end: "17:00" }],
    friday: [{ start: "09:00", end: "17:00" }],
    saturday: [],
    sunday: []
  }
};

function businessFilterByCanonical(canonicalId) {
  return { $or: [{ id: canonicalId }, { businessId: canonicalId }] };
}

async function main() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const bizCol = db.collection("businesses");

  console.log(`[fixCriticalQaData] Connected db=${mongoose.connection.name} dryRun=${dryRun}\n`);

  // --- Issue 1: Downtown Barber handle ---
  const barberBefore = await Business.findOne(businessFilterByCanonical(DOWNTOWN_BARBER.id)).lean();
  console.log("[1] Downtown Barber BEFORE:", { handle: barberBefore?.handle, name: barberBefore?.name, id: barberBefore?.id });
  if (!dryRun) {
    await bizCol.updateOne(businessFilterByCanonical(DOWNTOWN_BARBER.id), {
      $set: { handle: DOWNTOWN_BARBER.handle }
    });
  }
  const barberAfter = dryRun
    ? barberBefore
    : await Business.findOne(businessFilterByCanonical(DOWNTOWN_BARBER.id)).lean();
  console.log("[1] Downtown Barber AFTER:", { handle: barberAfter?.handle ?? "(set)" });

  // --- Issue 2: Fitness Studio services (Service collection) ---
  const svcCount = await Service.countDocuments({ businessId: FITNESS_STUDIO.businessId });
  console.log("\n[2] Fitness Studio Service count BEFORE:", svcCount);
  if (!dryRun && svcCount === 0) {
    for (const s of FITNESS_STUDIO.services) {
      try {
        await Service.create({
          businessId: FITNESS_STUDIO.businessId,
          serviceId: s.serviceId,
          name: s.name,
          durationMinutes: s.durationMinutes,
          active: true
        });
      } catch (e) {
        if (e.code !== 11000) throw e;
      }
    }
  } else if (!dryRun && svcCount > 0) {
    console.log("[2] Services already exist; skipping insert (idempotent).");
  } else if (dryRun && svcCount === 0) {
    console.log("[2] Would insert", FITNESS_STUDIO.services.length, "services");
  }
  const svcCountAfter = dryRun ? svcCount : await Service.countDocuments({ businessId: FITNESS_STUDIO.businessId });
  console.log("[2] Fitness Studio Service count AFTER:", svcCountAfter);

  // --- Issue 3: Display names ---
  for (const n of NAMES) {
    const b = await Business.findOne(n.filter).lean();
    console.log(`\n[3] ${n.name} BEFORE: name="${b?.name}"`);
    if (!dryRun) {
      await bizCol.updateOne(n.filter, { $set: { name: n.name } });
    }
    const b2 = dryRun ? b : await Business.findOne(n.filter).lean();
    console.log(`[3] ${n.name} AFTER: name="${b2?.name ?? n.name}"`);
  }

  // --- Issue 4: Ottawa Dental hours (business + Schedule) ---
  const ottawaId = OTTAWA_DENTAL.businessId;
  const ottawaBefore = await Business.findOne(businessFilterByCanonical(ottawaId)).lean();
  console.log("\n[4] Ottawa Dental weeklySchedule BEFORE:", JSON.stringify(ottawaBefore?.weeklySchedule, null, 2));
  const schedBefore = await Schedule.findOne({ businessId: ottawaId }).lean();
  console.log("[4] Ottawa Dental Schedule doc BEFORE:", JSON.stringify(schedBefore?.weeklyHours, null, 2));

  const ottawaTz =
    schedBefore?.timezone ||
    ottawaBefore?.weeklySchedule?.timezone ||
    ottawaBefore?.timezone ||
    "America/Toronto";

  if (!dryRun) {
    await bizCol.updateOne(businessFilterByCanonical(ottawaId), {
      $set: {
        "weeklySchedule.weeklyHours": OTTAWA_DENTAL.weeklyHours
      }
    });
    await Schedule.updateOne(
      { businessId: ottawaId },
      {
        $set: {
          weeklyHours: OTTAWA_DENTAL.weeklyHours,
          timezone: ottawaTz
        },
        $setOnInsert: { businessId: ottawaId }
      },
      { upsert: true }
    );
  }

  const ottawaAfter = dryRun
    ? ottawaBefore
    : await Business.findOne(businessFilterByCanonical(ottawaId)).lean();
  const schedAfter = dryRun
    ? schedBefore
    : await Schedule.findOne({ businessId: ottawaId }).lean();
  console.log("[4] Ottawa Dental weeklySchedule AFTER:", JSON.stringify(ottawaAfter?.weeklySchedule, null, 2));
  console.log("[4] Ottawa Dental Schedule doc AFTER:", JSON.stringify(schedAfter?.weeklyHours, null, 2));

  console.log("\n[fixCriticalQaData] Done.");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[fixCriticalQaData] Error:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

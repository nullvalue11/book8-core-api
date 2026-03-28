#!/usr/bin/env node
/**
 * Release specific Twilio numbers back to pool and clear phone fields on businesses.
 *
 * Usage:
 *   node scripts/releaseNumbers.js --dry-run
 *   node scripts/releaseNumbers.js
 *
 * Env:
 *   MONGODB_URI or MONGO_URI (required)
 */
import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dryRun = process.argv.includes("--dry-run");

const TARGETS = [
  { phone: "+15064048251", businessId: "biz_mmwfgpg50jkiub", name: "Ottawa Dental" },
  { phone: "+15795011441", businessId: "biz_mmzusq281oq7pb", name: "Fitness Studio" },
  { phone: "+14382561566", businessId: "biz_mmzzgvsy6tkwtm", name: "River City Massage" }
];

const EXCLUDED = {
  phone: "+16477882883",
  businessId: "biz_mmpsyemadcrxuc",
  name: "Downtown Barber"
};

function pickTwilioCollectionName(names) {
  const preferred = names.find((n) => n === "twilioNumbers");
  if (preferred) return preferred;

  const caseInsensitive = names.find((n) => n.toLowerCase() === "twilionumbers");
  if (caseInsensitive) return caseInsensitive;

  // Mongoose default for TwilioNumber model
  const mongooseDefault = names.find((n) => n === "twilionumbers");
  if (mongooseDefault) return mongooseDefault;

  return null;
}

function json(obj) {
  return JSON.stringify(obj, null, 2);
}

async function main() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const collectionInfos = await db.listCollections().toArray();
  const collectionNames = collectionInfos.map((c) => c.name);
  const twilioCollectionName = pickTwilioCollectionName(collectionNames);

  if (!twilioCollectionName) {
    console.error(
      "Could not find Twilio numbers collection (looked for twilioNumbers/twilionumbers)."
    );
    process.exit(1);
  }

  const twilioCol = db.collection(twilioCollectionName);
  const bizCol = db.collection("businesses");

  console.log(`[releaseNumbers] Connected. dryRun=${dryRun}`);
  console.log(`[releaseNumbers] Twilio collection: ${twilioCollectionName}`);
  console.log(`[releaseNumbers] Excluding: ${EXCLUDED.name} (${EXCLUDED.businessId}, ${EXCLUDED.phone})`);

  const targetPhones = TARGETS.map((t) => t.phone);
  const targetBizIds = TARGETS.map((t) => t.businessId);

  const beforeTwilio = await twilioCol
    .find({ phoneNumber: { $in: targetPhones } })
    .project({
      _id: 0,
      phoneNumber: 1,
      status: 1,
      assignedToBusinessId: 1,
      assignedTo: 1,
      businessId: 1,
      assignedAt: 1
    })
    .toArray();

  const beforeBiz = await bizCol
    .find({ $or: [{ id: { $in: targetBizIds } }, { businessId: { $in: targetBizIds } }] })
    .project({
      _id: 0,
      id: 1,
      businessId: 1,
      name: 1,
      assignedTwilioNumber: 1,
      twilioPhoneNumber: 1,
      phoneNumber: 1
    })
    .toArray();

  console.log("\n[releaseNumbers] BEFORE — twilio numbers");
  console.log(json(beforeTwilio));
  console.log("\n[releaseNumbers] BEFORE — businesses");
  console.log(json(beforeBiz));

  if (!dryRun) {
    const twilioUpdateResult = await twilioCol.updateMany(
      {
        phoneNumber: { $in: targetPhones, $ne: EXCLUDED.phone },
        $or: [
          { assignedToBusinessId: { $in: targetBizIds } },
          { assignedTo: { $in: targetBizIds } },
          { businessId: { $in: targetBizIds } },
          { assignedToBusinessId: { $exists: false } },
          { assignedTo: { $exists: false } },
          { businessId: { $exists: false } }
        ]
      },
      {
        $set: {
          status: "available",
          assignedToBusinessId: null,
          assignedTo: null,
          businessId: null,
          assignedAt: null,
          updatedAt: new Date()
        }
      }
    );

    const bizUpdateResult = await bizCol.updateMany(
      {
        $or: [{ id: { $in: targetBizIds } }, { businessId: { $in: targetBizIds } }],
        $and: [{ id: { $ne: EXCLUDED.businessId } }, { businessId: { $ne: EXCLUDED.businessId } }]
      },
      {
        // Use $unset for unique+sparse fields to avoid duplicate null key errors.
        $unset: {
          phoneNumber: 1,
          assignedTwilioNumber: 1,
          twilioPhoneNumber: 1
        }
      }
    );

    console.log("\n[releaseNumbers] UPDATE RESULTS");
    console.log(
      json({
        twilioNumbersMatched: twilioUpdateResult.matchedCount,
        twilioNumbersModified: twilioUpdateResult.modifiedCount,
        businessesMatched: bizUpdateResult.matchedCount,
        businessesModified: bizUpdateResult.modifiedCount
      })
    );
  } else {
    console.log("\n[releaseNumbers] DRY RUN — no updates performed.");
  }

  const afterTwilio = await twilioCol
    .find({ phoneNumber: { $in: targetPhones } })
    .project({
      _id: 0,
      phoneNumber: 1,
      status: 1,
      assignedToBusinessId: 1,
      assignedTo: 1,
      businessId: 1,
      assignedAt: 1
    })
    .toArray();

  const afterBiz = await bizCol
    .find({ $or: [{ id: { $in: targetBizIds } }, { businessId: { $in: targetBizIds } }] })
    .project({
      _id: 0,
      id: 1,
      businessId: 1,
      name: 1,
      assignedTwilioNumber: 1,
      twilioPhoneNumber: 1,
      phoneNumber: 1
    })
    .toArray();

  console.log("\n[releaseNumbers] AFTER — twilio numbers");
  console.log(json(afterTwilio));
  console.log("\n[releaseNumbers] AFTER — businesses");
  console.log(json(afterBiz));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[releaseNumbers] Error:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

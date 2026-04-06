#!/usr/bin/env node
/**
 * BOO-74A: example one-off handle backfill for specific business ids.
 * Edit ID/handle pairs, then run against book8-core (and book8 dashboard if needed):
 *
 *   MONGODB_URI="mongodb+srv://.../book8-core" node scripts/backfillBOO74Handles.example.mjs
 *
 * Do not commit real production IDs; copy this file or edit locally.
 */
import mongoose from "mongoose";

const UPDATES = [
  // { id: "biz_mnmmr26lnj5ug5", handle: "diamond-car-wash" },
  // { id: "biz_mnmqsh4xnfygae", handle: "diamond-car-wash-rideau" },
];

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("Set MONGODB_URI");
  process.exit(1);
}

if (UPDATES.length === 0) {
  console.log("No UPDATES configured — edit scripts/backfillBOO74Handles.example.mjs");
  process.exit(0);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;
for (const { id, handle } of UPDATES) {
  const r = await db.collection("businesses").updateOne({ id }, { $set: { handle } });
  console.log(id, handle, r.modifiedCount ? "updated" : "no change / not found");
}
await mongoose.disconnect();

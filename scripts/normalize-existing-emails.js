#!/usr/bin/env node
/**
 * BOO-91A: normalize customer.email to lowercase on existing bookings.
 *
 *   MONGODB_URI="..." node scripts/normalize-existing-emails.js --dry-run
 *   MONGODB_URI="..." node scripts/normalize-existing-emails.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (!uri) {
    console.error("Missing MONGODB_URI or MONGO_URI");
    process.exit(1);
  }

  await mongoose.connect(uri);

  const filter = { "customer.email": { $regex: /[A-Z]/ } };
  const bookings = await Booking.find(filter).lean();
  console.log(`Found ${bookings.length} bookings with uppercase letters in customer.email`);

  if (dryRun) {
    for (const b of bookings) {
      console.log(`Would update: ${b._id} ${b.id} ${b.customer?.email}`);
    }
    await mongoose.disconnect();
    return;
  }

  let n = 0;
  for (const row of bookings) {
    const doc = await Booking.findById(row._id);
    if (!doc?.customer?.email) continue;
    doc.customer.email = String(doc.customer.email).trim().toLowerCase();
    await doc.save();
    n++;
  }
  console.log(`Updated ${n} bookings`);
  await mongoose.disconnect();
  console.log("Done");
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

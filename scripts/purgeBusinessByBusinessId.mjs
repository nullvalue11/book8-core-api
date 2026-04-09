#!/usr/bin/env node
/**
 * Delete all book8-core-api data for a business when you only know businessId (and optional handle).
 * Use when the business row was removed manually but child documents may still exist.
 *
 * Usage:
 *   node scripts/purgeBusinessByBusinessId.mjs <businessId> [--handle slug] [--dry-run]
 *   node scripts/purgeBusinessByBusinessId.mjs biz_mnq3kabjl8odq2 --handle sohas-bodyyady-gym --yes
 *
 * Without --yes: dry-run (counts only).
 * Requires MONGODB_URI (or MONGO_URI) in env or .env
 */
import "dotenv/config";
import mongoose from "mongoose";

import { Business } from "../models/Business.js";
import { Booking } from "../models/Booking.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { Provider } from "../models/Provider.js";
import { Waitlist } from "../models/Waitlist.js";
import { Review } from "../models/Review.js";
import { SmsConversation } from "../models/SmsConversation.js";
import { Call } from "../models/Call.js";
import { TwilioNumber } from "../models/TwilioNumber.js";

function usage() {
  console.log(
    [
      "Usage:",
      "  node scripts/purgeBusinessByBusinessId.mjs <businessId> [--handle <slug>] [--yes]",
      "",
      "Examples:",
      '  node scripts/purgeBusinessByBusinessId.mjs biz_abc123 --handle my-gym',
      "  node scripts/purgeBusinessByBusinessId.mjs biz_abc123 --yes",
      "",
      "Without --yes: dry-run only."
    ].join("\n")
  );
}

const args = process.argv.slice(2);
const yes = args.includes("--yes");
let handle = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--yes") continue;
  if (args[i] === "--handle" && args[i + 1]) {
    handle = String(args[++i]).trim();
    continue;
  }
  rest.push(args[i]);
}
const businessId = rest[0];

if (!businessId) {
  usage();
  process.exit(1);
}

const bid = String(businessId).trim();
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error("MONGODB_URI or MONGO_URI not set. Aborting.");
  process.exit(1);
}

const relatedFilter = { businessId: bid };

async function main() {
  await mongoose.connect(uri);
  const dbName = mongoose.connection.name;

  const businessOr = [{ id: bid }, { businessId: bid }];
  if (handle) {
    businessOr.push({ handle });
  }

  const businesses = await Business.find({ $or: businessOr }).lean();

  const counts = {
    businesses: businesses.length,
    bookings: await Booking.countDocuments(relatedFilter),
    services: await Service.countDocuments(relatedFilter),
    schedules: await Schedule.countDocuments(relatedFilter),
    providers: await Provider.countDocuments(relatedFilter),
    waitlists: await Waitlist.countDocuments(relatedFilter),
    reviews: await Review.countDocuments(relatedFilter),
    smsConversations: await SmsConversation.countDocuments(relatedFilter),
    calls: await Call.countDocuments(relatedFilter),
    twilioNumbersAssigned: await TwilioNumber.countDocuments({
      assignedToBusinessId: bid
    })
  };

  console.log(
    JSON.stringify(
      {
        db: dbName,
        businessId: bid,
        handle: handle || null,
        businessDocsFound: businesses.map((b) => ({
          _id: String(b._id),
          id: b.id ?? null,
          businessId: b.businessId ?? null,
          handle: b.handle ?? null,
          name: b.name ?? null
        })),
        counts
      },
      null,
      2
    )
  );

  if (!yes) {
    console.log("\nDry run only. Re-run with --yes to delete and release Twilio rows.");
    await mongoose.disconnect();
    return;
  }

  const releasedTwilioNumbers = await TwilioNumber.updateMany(
    { assignedToBusinessId: bid },
    { $set: { assignedToBusinessId: null, assignedAt: null, status: "available" } }
  );

  const deletedBookings = await Booking.deleteMany(relatedFilter);
  const deletedServices = await Service.deleteMany(relatedFilter);
  const deletedSchedules = await Schedule.deleteMany(relatedFilter);
  const deletedProviders = await Provider.deleteMany(relatedFilter);
  const deletedWaitlists = await Waitlist.deleteMany(relatedFilter);
  const deletedReviews = await Review.deleteMany(relatedFilter);
  const deletedSmsConversations = await SmsConversation.deleteMany(relatedFilter);
  const deletedCalls = await Call.deleteMany(relatedFilter);
  const deletedBusinesses = await Business.deleteMany({ $or: businessOr });

  console.log(
    JSON.stringify(
      {
        releasedTwilioNumbers: releasedTwilioNumbers.modifiedCount ?? releasedTwilioNumbers.nModified ?? 0,
        deleted: {
          bookings: deletedBookings.deletedCount,
          services: deletedServices.deletedCount,
          schedules: deletedSchedules.deletedCount,
          providers: deletedProviders.deletedCount,
          waitlists: deletedWaitlists.deletedCount,
          reviews: deletedReviews.deletedCount,
          smsConversations: deletedSmsConversations.deletedCount,
          calls: deletedCalls.deletedCount,
          businesses: deletedBusinesses.deletedCount
        }
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

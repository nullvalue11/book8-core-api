import "dotenv/config";
import mongoose from "mongoose";

import { Business } from "../models/Business.js";
import { Booking } from "../models/Booking.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { SmsConversation } from "../models/SmsConversation.js";
import { Call } from "../models/Call.js";
import { TwilioNumber } from "../models/TwilioNumber.js";

function usage() {
  console.log(
    [
      "Usage:",
      "  node scripts/purgeBusinessByEmail.mjs <email> [--yes]",
      "",
      "Notes:",
      "- Requires MONGODB_URI in environment or .env",
      "- Without --yes, runs in dry-run mode (no deletes)."
    ].join("\n")
  );
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const email = process.argv[2];
const yes = process.argv.includes("--yes");

if (!email) {
  usage();
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set (env or .env). Aborting.");
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri);
  const dbName = mongoose.connection.name;

  const businesses = await Business.find({
    email: { $regex: `^${escapeRegex(email)}$`, $options: "i" }
  }).lean();

  console.log(
    JSON.stringify(
      {
        db: dbName,
        email,
        businessesFound: businesses.map((b) => ({
          _id: String(b._id),
          id: b.id ?? null,
          businessId: b.businessId ?? null,
          handle: b.handle ?? null,
          name: b.name ?? null,
          assignedTwilioNumber: b.assignedTwilioNumber ?? null
        }))
      },
      null,
      2
    )
  );

  if (businesses.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const bizIds = businesses
    .map((b) => (b.id ?? b.businessId ? String(b.id ?? b.businessId) : null))
    .filter(Boolean);
  const bizIdSet = [...new Set(bizIds)];

  const counts = {
    bookings: await Booking.countDocuments({ businessId: { $in: bizIdSet } }),
    services: await Service.countDocuments({ businessId: { $in: bizIdSet } }),
    schedules: await Schedule.countDocuments({ businessId: { $in: bizIdSet } }),
    smsConversations: await SmsConversation.countDocuments({ businessId: { $in: bizIdSet } }),
    calls: await Call.countDocuments({ businessId: { $in: bizIdSet } }),
    twilioNumbersAssigned: await TwilioNumber.countDocuments({
      assignedToBusinessId: { $in: bizIdSet }
    })
  };

  console.log(JSON.stringify({ dryRun: !yes, businessIds: bizIdSet, counts }, null, 2));

  if (!yes) {
    console.log("Dry run only. Re-run with --yes to delete.");
    await mongoose.disconnect();
    return;
  }

  // Release any pool numbers linked to the business id(s) so they can be reused.
  const releasedTwilioNumbers = await TwilioNumber.updateMany(
    { assignedToBusinessId: { $in: bizIdSet } },
    { $set: { assignedToBusinessId: null, assignedAt: null, status: "available" } }
  );

  const deletedBookings = await Booking.deleteMany({ businessId: { $in: bizIdSet } });
  const deletedServices = await Service.deleteMany({ businessId: { $in: bizIdSet } });
  const deletedSchedules = await Schedule.deleteMany({ businessId: { $in: bizIdSet } });
  const deletedSmsConversations = await SmsConversation.deleteMany({ businessId: { $in: bizIdSet } });
  const deletedCalls = await Call.deleteMany({ businessId: { $in: bizIdSet } });
  const deletedBusinesses = await Business.deleteMany({
    _id: { $in: businesses.map((b) => b._id) }
  });

  console.log(
    JSON.stringify(
      {
        releasedTwilioNumbers: releasedTwilioNumbers.modifiedCount ?? releasedTwilioNumbers.nModified ?? 0,
        deleted: {
          bookings: deletedBookings.deletedCount,
          services: deletedServices.deletedCount,
          schedules: deletedSchedules.deletedCount,
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


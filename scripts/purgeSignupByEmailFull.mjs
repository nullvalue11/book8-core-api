/**
 * Remove a dashboard signup: user + businesses in `book8`, and tenant rows in `book8-core`.
 * Usage:
 *   MONGODB_URI_BOOK8=mongodb+srv://.../book8
 *   MONGODB_URI_CORE=mongodb+srv://.../book8-core
 *   node scripts/purgeSignupByEmailFull.mjs wallogill237@gmail.com --yes
 *
 * If only MONGODB_URI is set, derives core URI by replacing last path segment with book8-core.
 */

import mongoose from "mongoose";

import { Business as CoreBusiness } from "../models/Business.js";
import { Booking } from "../models/Booking.js";
import { Service } from "../models/Service.js";
import { Schedule } from "../models/Schedule.js";
import { SmsConversation } from "../models/SmsConversation.js";
import { Call } from "../models/Call.js";
import { TwilioNumber } from "../models/TwilioNumber.js";

const email = process.argv[2];
const yes = process.argv.includes("--yes");

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Same cluster/user/pass; only database name changes. */
function coreUriFromBook8(uri) {
  if (!uri || typeof uri !== "string") return null;
  const withCore = uri.replace(/\/([a-zA-Z0-9_-]+)(\?|$)/, "/book8-core$2");
  return withCore !== uri ? withCore : null;
}

async function purgeBook8Main(uri, report) {
  const conn = await mongoose.createConnection(uri).asPromise();
  const db = conn.db;
  const re = new RegExp(`^${escapeRegex(email)}$`, "i");

  const users = await db.collection("users").find({ email: re }).toArray();
  const businesses = await db.collection("businesses").find({ ownerEmail: re }).toArray();

  const userUuids = [...new Set(users.map((u) => u.id).filter(Boolean))];
  const bizIds = [
    ...new Set(
      businesses
        .flatMap((b) => [b.id, b.businessId].filter(Boolean))
        .map(String)
    )
  ];

  report.book8 = {
    db: db.databaseName,
    usersFound: users.length,
    businessesFound: businesses.length,
    userUuids,
    businessIds: bizIds
  };

  if (!yes) {
    await conn.close();
    return;
  }

  const releasedTwilio = await db.collection("twilionumbers").updateMany(
    { assignedToBusinessId: { $in: bizIds } },
    { $set: { assignedToBusinessId: null, assignedAt: null, status: "available" } }
  );

  const byBusinessId = { businessId: { $in: bizIds } };
  const del = {};
  del.bookings = (await db.collection("bookings").deleteMany(byBusinessId)).deletedCount;
  del.services = (await db.collection("services").deleteMany(byBusinessId)).deletedCount;
  del.schedules = (await db.collection("schedules").deleteMany(byBusinessId)).deletedCount;
  del.calls = (await db.collection("calls").deleteMany(byBusinessId)).deletedCount;
  del.smsconversations = (await db.collection("smsconversations").deleteMany(byBusinessId)).deletedCount;
  del.google_events = (await db.collection("google_events").deleteMany(byBusinessId)).deletedCount;
  del.public_booking_tokens = (await db.collection("public_booking_tokens").deleteMany(byBusinessId)).deletedCount;

  for (const coll of [
    "ops_audit_logs",
    "ops_event_logs",
    "ops_executions",
    "provisioningAlerts",
    "status_checks",
    "billing_logs"
  ]) {
    try {
      del[coll] = (await db.collection(coll).deleteMany(byBusinessId)).deletedCount;
    } catch {
      // optional collections / shape differences
    }
  }

  if (userUuids.length) {
    del.ops_locks = (await db.collection("ops_locks").deleteMany({ ownerUserId: { $in: userUuids } })).deletedCount;
  }

  del.businesses = (await db.collection("businesses").deleteMany({ ownerEmail: re })).deletedCount;
  del.users = (await db.collection("users").deleteMany({ email: re })).deletedCount;
  del.password_reset_requests = (await db.collection("password_reset_requests").deleteMany({ email: re })).deletedCount;
  del.password_reset_tokens = (await db.collection("password_reset_tokens").deleteMany({ email: re })).deletedCount;

  report.book8.deleted = del;
  report.book8.releasedTwilioNumbers = releasedTwilio.modifiedCount ?? releasedTwilio.nModified ?? 0;

  await conn.close();
}

async function purgeBook8Core(uri, bizIds, report) {
  if (!bizIds.length) {
    report.book8core = { skipped: true, reason: "no business ids" };
    return;
  }
  await mongoose.connect(uri);
  const releasedTwilioNumbers = await TwilioNumber.updateMany(
    { assignedToBusinessId: { $in: bizIds } },
    { $set: { assignedToBusinessId: null, assignedAt: null, status: "available" } }
  );

  const deleted = {
    bookings: (await Booking.deleteMany({ businessId: { $in: bizIds } })).deletedCount,
    services: (await Service.deleteMany({ businessId: { $in: bizIds } })).deletedCount,
    schedules: (await Schedule.deleteMany({ businessId: { $in: bizIds } })).deletedCount,
    smsConversations: (await SmsConversation.deleteMany({ businessId: { $in: bizIds } })).deletedCount,
    calls: (await Call.deleteMany({ businessId: { $in: bizIds } })).deletedCount,
    businesses: (await CoreBusiness.deleteMany({
      $or: [{ id: { $in: bizIds } }, { businessId: { $in: bizIds } }]
    })).deletedCount
  };

  report.book8core = {
    db: mongoose.connection.name,
    releasedTwilioNumbers: releasedTwilioNumbers.modifiedCount ?? releasedTwilioNumbers.nModified ?? 0,
    deleted
  };

  await mongoose.disconnect();
}

async function main() {
  if (!email) {
    console.error("Usage: node scripts/purgeSignupByEmailFull.mjs <email> [--yes]");
    process.exit(1);
  }

  const uriBook8 = process.env.MONGODB_URI_BOOK8 || process.env.MONGODB_URI;
  let uriCore = process.env.MONGODB_URI_CORE || coreUriFromBook8(uriBook8);

  if (!uriBook8) {
    console.error("Set MONGODB_URI_BOOK8 or MONGODB_URI");
    process.exit(1);
  }
  if (!uriCore) {
    console.error("Set MONGODB_URI_CORE (could not derive from book8 URI)");
    process.exit(1);
  }

  const report = { email, dryRun: !yes };
  await purgeBook8Main(uriBook8, report);

  const bizIds = report.book8?.businessIds || [];
  if (yes && bizIds.length) {
    await purgeBook8Core(uriCore, bizIds, report);
  } else if (!yes) {
    report.book8core = {
      dryRunNote: "Would purge book8-core tenant rows for businessIds",
      businessIds: bizIds
    };
  } else {
    report.book8core = { skipped: true, reason: "no business ids from book8" };
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

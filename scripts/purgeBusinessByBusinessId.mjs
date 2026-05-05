#!/usr/bin/env node
/**
 * Delete all book8-core-api data for a business when you only know businessId (and optional handle).
 * This script operates ONLY on the database referenced by MONGODB_URI (or MONGO_URI).
 *
 * Note: we also clean up dashboard-side collections (google_events, public_booking_tokens, etc.)
 * when running against the `book8` database, but we intentionally PRESERVE `ops_event_logs`
 * (retention policy; see BOO-CANCEL-1A).
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

function dbNameFromUri(u) {
  try {
    const pathname = new URL(u.replace(/^mongodb\+srv:/, "https:")).pathname;
    return pathname.replace(/^\//, "").split("/")[0]?.split("?")[0] || "";
  } catch {
    return "";
  }
}

function uriWithDatabaseName(uri, dbName) {
  if (!uri || !dbName) return null;
  const replaced = uri.replace(/\/([a-zA-Z0-9_-]+)(\?|$)/, `/${dbName}$2`);
  return replaced !== uri ? replaced : null;
}

const BOOK8_REPORT_COLLECTIONS = [
  "bookings",
  "services",
  "schedules",
  "calls",
  "smsconversations",
  "google_events",
  "public_booking_tokens",
  "ops_audit_logs",
  "ops_event_logs",
  "ops_executions",
  "provisioningAlerts",
  "status_checks",
  "billing_logs"
];

// What we actually delete in the dashboard `book8` DB. MUST NOT include ops_event_logs.
const BOOK8_DELETE_COLLECTIONS = BOOK8_REPORT_COLLECTIONS.filter((c) => c !== "ops_event_logs");

async function dashboardInspect(dashboardUri, bizIds) {
  if (!dashboardUri) {
    return { skipped: true, reason: "no_dashboard_uri" };
  }
  if (!Array.isArray(bizIds) || bizIds.length === 0) {
    return { skipped: true, reason: "no_business_ids" };
  }

  let conn;
  try {
    conn = await mongoose.createConnection(dashboardUri).asPromise();
    const db = conn.db;
    const filter = { businessId: { $in: bizIds } };
    const bizFilter = { $or: [{ id: { $in: bizIds } }, { businessId: { $in: bizIds } }] };

    const counts = { database: db.databaseName, businesses: await db.collection("businesses").countDocuments(bizFilter) };
    for (const coll of BOOK8_REPORT_COLLECTIONS) {
      try {
        // ops_event_logs uses meta.businessId (not businessId) by convention.
        const f = coll === "ops_event_logs" ? { "meta.businessId": { $in: bizIds } } : filter;
        counts[coll] = await db.collection(coll).countDocuments(f);
      } catch {
        counts[coll] = null;
      }
    }
    let twilioAssigned = 0;
    try {
      twilioAssigned = await db.collection("twilionumbers").countDocuments({ assignedToBusinessId: { $in: bizIds } });
    } catch {
      twilioAssigned = null;
    }
    counts.twilionumbers_assigned_to_business = twilioAssigned;
    return { skipped: false, counts };
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* */
      }
    }
  }
}

async function dashboardPurge(dashboardUri, bizIds) {
  if (!dashboardUri) {
    return { skipped: true, reason: "no_dashboard_uri" };
  }
  let conn;
  try {
    conn = await mongoose.createConnection(dashboardUri).asPromise();
    const db = conn.db;
    const filter = { businessId: { $in: bizIds } };
    const out = { database: db.databaseName, deleted: {} };

    for (const coll of BOOK8_DELETE_COLLECTIONS) {
      try {
        out.deleted[coll] = (await db.collection(coll).deleteMany(filter)).deletedCount || 0;
      } catch {
        out.deleted[coll] = 0;
      }
    }

    try {
      const r = await db.collection("twilionumbers").updateMany(
        { assignedToBusinessId: { $in: bizIds } },
        { $set: { assignedToBusinessId: null, assignedAt: null, status: "available" } }
      );
      out.twilionumbersReleased = r.modifiedCount ?? r.nModified ?? 0;
    } catch {
      out.twilionumbersReleased = 0;
    }

    try {
      const r = await db.collection("businesses").deleteMany({
        $or: [{ id: { $in: bizIds } }, { businessId: { $in: bizIds } }]
      });
      out.deleted.businesses = r.deletedCount || 0;
    } catch {
      out.deleted.businesses = 0;
    }

    return { skipped: false, ...out };
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* */
      }
    }
  }
}

const CORE_TENANT_COLLECTIONS = [
  "bookings",
  "services",
  "schedules",
  "providers",
  "waitlists",
  "reviews",
  "smsconversations",
  "calls"
];

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
  const primaryDb = dbNameFromUri(uri);

  const businessOr = [{ id: bid }, { businessId: bid }];
  if (handle) {
    businessOr.push({ handle });
  }

  const businesses = await Business.find({ $or: businessOr }).lean();

  const bizIds = [
    ...new Set([bid, ...businesses.flatMap((b) => [b.id, b.businessId].filter(Boolean))].map(String))
  ];

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

  /** Ops / tokens on `book8` when MONGODB_URI already points at the dashboard DB. */
  const dashboardOnPrimaryPreview =
    primaryDb === "book8" ? await dashboardInspect(uri, bizIds) : { skipped: true, reason: "primary is not book8" };

  console.log(
    JSON.stringify(
      {
        db: dbName,
        businessId: bid,
        bizIds,
        handle: handle || null,
        businessDocsFound: businesses.map((b) => ({
          _id: String(b._id),
          id: b.id ?? null,
          businessId: b.businessId ?? null,
          handle: b.handle ?? null,
          name: b.name ?? null
        })),
        counts,
        dashboardCollectionsOnPrimary: dashboardOnPrimaryPreview
      },
      null,
      2
    )
  );

  if (!yes) {
    console.log("\nDry run only. Re-run with --yes to delete on the current MONGODB_URI database.");
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

  const dashboardOnPrimaryResult =
    primaryDb === "book8" ? await dashboardPurge(uri, bizIds) : { skipped: true, reason: "primary is not book8" };

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
        },
        dashboardCollectionsOnPrimary: dashboardOnPrimaryResult
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

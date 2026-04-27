/**
 * BOO-MEM-1A: returning caller context — string helpers + optional Mongo integration
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert";
import mongoose from "mongoose";
import "dotenv/config";
import { Booking } from "../models/Booking.js";
import { Service } from "../models/Service.js";
import { Business } from "../models/Business.js";
import { generateBookingId, normalizePhoneForLookupMatch } from "../services/bookingService.js";
import {
  callerContextToDynamicVariables,
  emptyCallerDynamicVariables,
  lookupCallerContext
} from "../services/callerRecognition.js";

describe("callerContextToDynamicVariables (BOO-MEM-1A)", () => {
  it("unknown → all strings, false", () => {
    const d = callerContextToDynamicVariables({
      caller_known: false,
      caller_name: null,
      caller_email_masked: null,
      last_booking_date: null,
      last_service_name: null
    });
    assert.strictEqual(d.caller_known, "false");
    assert.strictEqual(d.caller_name, "");
    assert.strictEqual(d.caller_email_masked, "");
    assert.strictEqual(d.last_booking_date, "");
    assert.strictEqual(d.last_service_name, "");
  });

  it("known → string true and field passthrough", () => {
    const d = callerContextToDynamicVariables({
      caller_known: true,
      caller_name: "Pat",
      caller_email_masked: "ab***@x.com",
      last_booking_date: "2026-04-20",
      last_service_name: "Detail"
    });
    assert.strictEqual(d.caller_known, "true");
    assert.strictEqual(d.caller_name, "Pat");
    assert.strictEqual(d.caller_email_masked, "ab***@x.com");
    assert.strictEqual(d.last_booking_date, "2026-04-20");
    assert.strictEqual(d.last_service_name, "Detail");
  });

  it("emptyCallerDynamicVariables matches unknown shape", () => {
    const d = emptyCallerDynamicVariables();
    assert.strictEqual(d.caller_known, "false");
    assert.strictEqual(d.caller_name, "");
  });
});

const BIZ_A = "biz_TEST_mem1a_a";
const BIZ_B = "biz_TEST_mem1a_b";
const SVC_1 = "mem-svc-1";
const PHONE_E164 = "+15005550001";
const PHONE_PRETTY = "+1 500 555 0001";

function isoFromNow(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString();
}

let mongoConnected = false;
let mongoUnavailableLogged = false;

function logMongoUnavailableOnce() {
  if (mongoUnavailableLogged) return;
  mongoUnavailableLogged = true;
  console.warn("[callerRecognition] Mongo not available — skipping integration tests.");
}

/** Skip must be decided at test run time: `{ skip: !mongoConnected }` is evaluated when `it()` registers, before `before` hooks run. */
function skipIntegrationIfNoMongo(t) {
  if (mongoConnected) return false;
  logMongoUnavailableOnce();
  t.skip("Mongo not available");
  return true;
}

describe("lookupCallerContext integration (BOO-MEM-1A)", () => {
  before(async () => {
    if (!process.env.MONGODB_URI) {
      mongoConnected = false;
      return;
    }
    try {
      const rs = mongoose.connection.readyState;
      if (rs === 0) {
        await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      } else if (rs === 2) {
        await mongoose.connection.asPromise();
      }
      mongoConnected = mongoose.connection.readyState === 1;
    } catch (e) {
      mongoUnavailableLogged = true;
      console.warn("[callerRecognition] Mongo not available — skipping integration tests:", e?.message);
      mongoConnected = false;
    }
  });

  after(async () => {
    if (!mongoConnected) return;
    await Booking.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
    await Service.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
    await Business.deleteMany({ id: { $in: [BIZ_A, BIZ_B] } });
  });

  before(async () => {
    if (!mongoConnected) return;
    await Booking.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
    await Business.findOneAndUpdate(
      { id: BIZ_A },
      { $set: { id: BIZ_A, name: "Mem1a A", timezone: "America/Toronto", plan: "growth" } },
      { upsert: true }
    );
    await Business.findOneAndUpdate(
      { id: BIZ_B },
      { $set: { id: BIZ_B, name: "Mem1a B", timezone: "America/Toronto", plan: "growth" } },
      { upsert: true }
    );
    await Service.findOneAndUpdate(
      { businessId: BIZ_A, serviceId: SVC_1 },
      {
        $set: { businessId: BIZ_A, serviceId: SVC_1, name: "Full Detail", active: true, durationMinutes: 60 }
      },
      { upsert: true }
    );
  });

  afterEach(async () => {
    if (!mongoConnected) return;
    await Booking.deleteMany({ businessId: { $in: [BIZ_A, BIZ_B] } });
  });

  it("known caller: recent confirmed booking with masked email and service name", async (t) => {
    if (skipIntegrationIfNoMongo(t)) return;
    const id = generateBookingId();
    const start = isoFromNow(7);
    const end = new Date(new Date(start).getTime() + 3600000).toISOString();
    await Booking.create({
      id,
      businessId: BIZ_A,
      serviceId: SVC_1,
      customer: { name: "Pat Mem", phone: PHONE_E164, email: "ab@ex.com" },
      slot: { start, end, timezone: "America/Toronto" },
      status: "confirmed"
    });
    const r = await lookupCallerContext(BIZ_A, PHONE_E164, { timezone: "America/Toronto" });
    assert.strictEqual(r.caller_known, true);
    assert.strictEqual(r.caller_name, "Pat Mem");
    assert.strictEqual(r.caller_email_masked, "a***@ex.com");
    assert.strictEqual(r.last_service_name, "Full Detail");
    assert.match(r.last_booking_date || "", /^\d{4}-\d{2}-\d{2}$/);
    await Booking.deleteOne({ id });
  });

  it("unknown caller: no booking", async (t) => {
    if (skipIntegrationIfNoMongo(t)) return;
    const r = await lookupCallerContext(BIZ_A, "+15009999999", { timezone: "America/Toronto" });
    assert.strictEqual(r.caller_known, false);
    assert.strictEqual(r.caller_name, null);
  });

  it("stale slot: older than maxAgeDays → unknown", async (t) => {
    if (skipIntegrationIfNoMongo(t)) return;
    const id = generateBookingId();
    const start = isoFromNow(-400);
    const end = new Date(new Date(start).getTime() + 3600000).toISOString();
    await Booking.create({
      id,
      businessId: BIZ_A,
      serviceId: SVC_1,
      customer: { name: "Old", phone: PHONE_E164, email: "x@y.z" },
      slot: { start, end, timezone: "America/Toronto" },
      status: "confirmed"
    });
    const r = await lookupCallerContext(BIZ_A, PHONE_E164, { timezone: "America/Toronto", maxAgeDays: 365 });
    assert.strictEqual(r.caller_known, false);
    await Booking.deleteOne({ id });
  });

  it("wrong business: same phone, different businessId → unknown", async (t) => {
    if (skipIntegrationIfNoMongo(t)) return;
    const id = generateBookingId();
    const start = isoFromNow(3);
    const end = new Date(new Date(start).getTime() + 3600000).toISOString();
    await Booking.create({
      id,
      businessId: BIZ_A,
      serviceId: SVC_1,
      customer: { name: "Scoper", phone: PHONE_E164, email: "s@a.b" },
      slot: { start, end, timezone: "America/Toronto" },
      status: "confirmed"
    });
    const r = await lookupCallerContext(BIZ_B, PHONE_E164, { timezone: "America/Toronto" });
    assert.strictEqual(r.caller_known, false);
    await Booking.deleteOne({ id });
  });

  it("cancelled still recognized", async (t) => {
    if (skipIntegrationIfNoMongo(t)) return;
    const id = generateBookingId();
    const start = isoFromNow(5);
    const end = new Date(new Date(start).getTime() + 3600000).toISOString();
    await Booking.create({
      id,
      businessId: BIZ_A,
      serviceId: SVC_1,
      customer: { name: "Can", phone: PHONE_E164, email: "c@d.e" },
      slot: { start, end, timezone: "America/Toronto" },
      status: "cancelled"
    });
    const r = await lookupCallerContext(BIZ_A, PHONE_E164, { timezone: "America/Toronto" });
    assert.strictEqual(r.caller_known, true);
    assert.strictEqual(r.caller_name, "Can");
    await Booking.deleteOne({ id });
  });

  it("phone format variants match stored E.164", async (t) => {
    if (skipIntegrationIfNoMongo(t)) return;
    const id = generateBookingId();
    const start = isoFromNow(10);
    const end = new Date(new Date(start).getTime() + 3600000).toISOString();
    await Booking.create({
      id,
      businessId: BIZ_A,
      serviceId: SVC_1,
      customer: { name: "Fmt", phone: PHONE_E164, email: null },
      slot: { start, end, timezone: "America/Toronto" },
      status: "confirmed"
    });
    const r = await lookupCallerContext(BIZ_A, PHONE_PRETTY, { timezone: "America/Toronto" });
    assert.strictEqual(r.caller_known, true);
    assert.strictEqual(normalizePhoneForLookupMatch(PHONE_E164), normalizePhoneForLookupMatch(PHONE_PRETTY));
    await Booking.deleteOne({ id });
  });
});

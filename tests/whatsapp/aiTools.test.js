/**
 * BOO-INFOBIP-AI-HANDLER-1A — WhatsApp AI tool dispatch unit tests
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app } from "../../index.js";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { Booking } from "../../models/Booking.js";
import { executeTool, getToolDefinitions } from "../../src/services/whatsapp/aiTools.js";
import { WhatsappConversation } from "../../src/models/WhatsappConversation.js";
import { processConversation } from "../../src/services/whatsapp/aiHandler.js";

const BIZ = "biz_whatsapp_ai_tools_test";
const PHONE = "+15559990001";
const PHONE_OTHER = "+15559990002";

const TEST_MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/book8-core";

async function ensureMongoConnected() {
  const c = mongoose.connection;
  if (c.readyState === 1) return;
  if (c.readyState === 2 && typeof c.asPromise === "function") {
    await c.asPromise();
    return;
  }
  await mongoose.connect(TEST_MONGO_URI);
}

void app;

describe("whatsapp aiTools", () => {
  before(async () => {
    await ensureMongoConnected();
    await Business.findOneAndUpdate(
      { id: BIZ },
      {
        $set: {
          id: BIZ,
          name: "WA Tools Co",
          timezone: "America/Toronto",
          plan: "growth",
          services: [
            { id: "svc_wax", name: "Wax", duration: 60, price: 50, active: true }
          ]
        }
      },
      { upsert: true }
    );
    await Service.findOneAndUpdate(
      { businessId: BIZ, serviceId: "svc_wax" },
      {
        $set: {
          businessId: BIZ,
          serviceId: "svc_wax",
          name: "Wax",
          durationMinutes: 60,
          price: 50,
          active: true
        }
      },
      { upsert: true }
    );
  });

  after(async () => {
    await Booking.deleteMany({ businessId: BIZ });
    await Service.deleteMany({ businessId: BIZ });
    await Business.deleteOne({ id: BIZ });
  });

  it("getToolDefinitions returns six tools", () => {
    const t = getToolDefinitions();
    assert.equal(t.length, 6);
  });

  it("get_business_info returns success with business fields", async () => {
    const business = await Business.findOne({ id: BIZ }).lean();
    const conv = { customerPhone: PHONE, language: "en" };
    const r = await executeTool("get_business_info", {}, { business, conversation: conv });
    assert.equal(r.success, true);
    assert.equal(r.data.name, "WA Tools Co");
  });

  it("check_availability returns failure for unknown service", async () => {
    const business = await Business.findOne({ id: BIZ }).lean();
    const conv = { customerPhone: PHONE };
    const r = await executeTool(
      "check_availability",
      { service_id: "svc_noexist", date: "2099-01-02" },
      { business, conversation: conv }
    );
    assert.equal(r.success, false);
    assert.ok(String(r.userMessage || "").length > 0);
  });

  it("cancel_booking rejects phone mismatch", async () => {
    const start = new Date(Date.now() + 86400000).toISOString();
    const end = new Date(Date.now() + 86400000 + 3600000).toISOString();
    await Booking.create({
      id: "bk_test_wa_mismatch",
      businessId: BIZ,
      serviceId: "svc_wax",
      customer: { name: "A", phone: PHONE_OTHER },
      slot: { start, end, timezone: "America/Toronto" },
      status: "confirmed",
      language: "en"
    });
    const business = await Business.findOne({ id: BIZ }).lean();
    const conv = { customerPhone: PHONE };
    const r = await executeTool(
      "cancel_booking",
      { booking_id: "bk_test_wa_mismatch" },
      { business, conversation: conv }
    );
    await Booking.deleteOne({ id: "bk_test_wa_mismatch" });
    assert.equal(r.success, false);
    assert.match(String(r.userMessage || ""), /number|find/i);
  });
});

const HANDLER_BIZ = "biz_whatsapp_ai_handler_test";
const HANDLER_PHONE = "+15559990003";

describe("whatsapp aiHandler", () => {
  let prevDry;
  let prevKey;

  before(async () => {
    prevDry = process.env.WHATSAPP_AI_TEST_DRY;
    prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.WHATSAPP_AI_TEST_DRY = "1";
    delete process.env.ANTHROPIC_API_KEY;

    await Business.findOneAndUpdate(
      { id: HANDLER_BIZ },
      {
        $set: {
          id: HANDLER_BIZ,
          name: "WA Handler Co",
          timezone: "America/Toronto",
          plan: "growth"
        }
      },
      { upsert: true }
    );
  });

  after(async () => {
    process.env.WHATSAPP_AI_TEST_DRY = prevDry;
    if (prevKey != null) process.env.ANTHROPIC_API_KEY = prevKey;
    else delete process.env.ANTHROPIC_API_KEY;
    await WhatsappConversation.deleteMany({ businessId: HANDLER_BIZ });
    await Business.deleteOne({ id: HANDLER_BIZ });
  });

  it("skips _unrouted conversations", async () => {
    const c = await WhatsappConversation.create({
      businessId: "_unrouted",
      customerPhone: "+15559990099",
      windowExpiresAt: new Date(Date.now() + 3600000),
      messages: [
        {
          messageId: "m_unrouted_1",
          direction: "inbound",
          type: "text",
          content: { text: "hi" },
          rawPayload: {},
          createdAt: new Date()
        }
      ]
    });
    await processConversation(c._id);
    const reloaded = await WhatsappConversation.findById(c._id).lean();
    assert.equal(reloaded.messages.length, 1);
    await WhatsappConversation.deleteOne({ _id: c._id });
  });

  it("dry mode appends fallback outbound when Anthropic key missing", async () => {
    const c = await WhatsappConversation.create({
      businessId: HANDLER_BIZ,
      customerPhone: HANDLER_PHONE,
      windowExpiresAt: new Date(Date.now() + 3600000),
      messages: [
        {
          messageId: "m_handler_1",
          direction: "inbound",
          type: "text",
          content: { text: "Hello" },
          rawPayload: {},
          createdAt: new Date()
        }
      ]
    });
    await processConversation(c._id);
    const reloaded = await WhatsappConversation.findById(c._id).lean();
    assert.ok(reloaded.messages.length >= 2);
    const out = reloaded.messages.find((m) => m.direction === "outbound");
    assert.ok(out);
    assert.ok(String(out.content?.text || "").includes("Sorry"));
    assert.ok(out.meta?.model);
  });
});

after(async () => {
  await mongoose.disconnect().catch(() => {});
});

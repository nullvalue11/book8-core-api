/**
 * BOO-INFOBIP-SENDER-FALLBACK-1A — sendText + businessId + Mongo (shared INFOBIP_SENDER fallback)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app } from "../../index.js";
import { Business } from "../../models/Business.js";
import { sendText } from "../../services/infobip/infobipClient.js";

void app;

const BIZ = "biz_infobip_sender_mongo_test";

describe("sendText with businessId (Mongo)", () => {
  let prevSender;

  before(async () => {
    prevSender = process.env.INFOBIP_SENDER;
    process.env.INFOBIP_SENDER = "+15550003333";
    await Business.findOneAndUpdate(
      { id: BIZ },
      { $set: { id: BIZ, name: "Sender mongo test", plan: "growth" } },
      { upsert: true }
    );
  });

  after(async () => {
    await Business.deleteOne({ id: BIZ });
    if (prevSender != null) process.env.INFOBIP_SENDER = prevSender;
    else delete process.env.INFOBIP_SENDER;
    delete process.env.INFOBIP_API_KEY;
    delete process.env.INFOBIP_BASE_URL;
    globalThis.fetch = undefined;
    await mongoose.disconnect();
  });

  it("uses INFOBIP_SENDER when business has no whatsappSenderNumber", async () => {
    process.env.INFOBIP_BASE_URL = "https://example.infobip.com";
    process.env.INFOBIP_API_KEY = "secret-key";

    let captured = /** @type {{ opts: RequestInit }} */ ({ opts: {} });
    globalThis.fetch = async (_url, opts) => {
      captured = { opts };
      return {
        ok: true,
        status: 200,
        text: async () => '{"messages":[{"messageId":"mid"}]}'
      };
    };

    await sendText({ to: "+16130001111", text: "Hi", businessId: BIZ });
    const body = JSON.parse(String(captured.opts.body || "{}"));
    assert.equal(body.from, "15550003333");
  });

  it("prefers business whatsappSenderNumber over INFOBIP_SENDER", async () => {
    await Business.updateOne({ id: BIZ }, { $set: { whatsappSenderNumber: "+14442223333" } });
    process.env.INFOBIP_BASE_URL = "https://example.infobip.com";
    process.env.INFOBIP_API_KEY = "secret-key";

    let captured = /** @type {{ opts: RequestInit }} */ ({ opts: {} });
    globalThis.fetch = async (_url, opts) => {
      captured = { opts };
      return {
        ok: true,
        status: 200,
        text: async () => '{"messages":[{"messageId":"mid"}]}'
      };
    };

    await sendText({ to: "+16130001111", text: "Hi", businessId: BIZ });
    const body = JSON.parse(String(captured.opts.body || "{}"));
    assert.equal(body.from, "14442223333");
    await Business.updateOne({ id: BIZ }, { $unset: { whatsappSenderNumber: 1 } });
  });
});

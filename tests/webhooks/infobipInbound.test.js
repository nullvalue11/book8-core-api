/**
 * BOO-INFOBIP-INBOUND-WEBHOOK-1A — POST /api/webhooks/infobip/inbound
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import request from "supertest";
import { app } from "../../index.js";
import { Business } from "../../models/Business.js";
import { WhatsappConversation } from "../../src/models/WhatsappConversation.js";

const SECRET = "test-infobip-webhook-secret-for-unit-tests-ok";
const BIZ_TOKEN = "biz_whatsapp_inbound_test_a";
const PHONE_ROUTED = "+971501111111";
const PHONE_EXISTING = "+971502222222";
const PHONE_UNROUTED = "+971503333333";
const PHONE_MEDIA = "+971504444444";

function signRawBody(raw) {
  return crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
}

function postInbound(bodyObj, { signature } = {}) {
  const raw = typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
  const sig = signature ?? signRawBody(raw);
  return request(app)
    .post("/api/webhooks/infobip/inbound")
    .set("Content-Type", "application/json")
    .set("X-Infobip-Signature", sig)
    .send(raw);
}

function sampleTextResult(overrides = {}) {
  return {
    messageId: overrides.messageId || crypto.randomUUID(),
    from: overrides.from || PHONE_ROUTED.replace("+", ""),
    receivedAt: overrides.receivedAt || new Date().toISOString(),
    message: {
      type: "TEXT",
      text: overrides.text ?? "Hello",
      ...(overrides.messageExtra || {})
    },
    ...overrides.extra
  };
}

describe("POST /api/webhooks/infobip/inbound", () => {
  before(async () => {
    process.env.INFOBIP_WEBHOOK_SECRET = SECRET;
    await Business.findOneAndUpdate(
      { id: BIZ_TOKEN },
      { $set: { id: BIZ_TOKEN, name: "WhatsApp inbound test biz" } },
      { upsert: true, new: true }
    );
    await WhatsappConversation.deleteMany({
      customerPhone: { $in: [PHONE_ROUTED, PHONE_EXISTING, PHONE_UNROUTED, PHONE_MEDIA] }
    });
  });

  after(async () => {
    await WhatsappConversation.deleteMany({
      customerPhone: { $in: [PHONE_ROUTED, PHONE_EXISTING, PHONE_UNROUTED, PHONE_MEDIA] }
    });
    await Business.deleteOne({ id: BIZ_TOKEN });
  });

  it("creates conversation with businessId from [BIZ:…] token and strips marker from stored text", async () => {
    const messageId = crypto.randomUUID();
    const body = {
      results: [
        sampleTextResult({
          messageId,
          from: PHONE_ROUTED.replace("+", ""),
          text: `Book please [BIZ:${BIZ_TOKEN}]`
        })
      ]
    };
    const res = await postInbound(body);
    assert.equal(res.status, 200);

    const doc = await WhatsappConversation.findOne({
      businessId: BIZ_TOKEN,
      customerPhone: PHONE_ROUTED
    }).lean();
    assert.ok(doc);
    assert.equal(doc.messages.length, 1);
    assert.equal(doc.messages[0].content.text, "Book please");
    assert.equal(doc.messages[0].type, "text");
  });

  it("routes to _unrouted when no token and no active conversation", async () => {
    const messageId = crypto.randomUUID();
    const body = {
      results: [
        sampleTextResult({
          messageId,
          from: PHONE_UNROUTED.replace("+", ""),
          text: "Cold inbound"
        })
      ]
    };
    const res = await postInbound(body);
    assert.equal(res.status, 200);

    const doc = await WhatsappConversation.findOne({
      businessId: "_unrouted",
      customerPhone: PHONE_UNROUTED
    }).lean();
    assert.ok(doc);
    assert.equal(doc.messages[0].content.text, "Cold inbound");
  });

  it("appends to existing active conversation when no token", async () => {
    await WhatsappConversation.create({
      businessId: BIZ_TOKEN,
      customerPhone: PHONE_EXISTING,
      status: "active",
      messages: [
        {
          messageId: crypto.randomUUID(),
          direction: "inbound",
          type: "text",
          content: { text: "prior" },
          rawPayload: {},
          createdAt: new Date()
        }
      ]
    });

    const messageId = crypto.randomUUID();
    const body = {
      results: [
        sampleTextResult({
          messageId,
          from: PHONE_EXISTING.replace("+", ""),
          text: "Second message"
        })
      ]
    };
    const res = await postInbound(body);
    assert.equal(res.status, 200);

    const doc = await WhatsappConversation.findOne({
      businessId: BIZ_TOKEN,
      customerPhone: PHONE_EXISTING
    }).lean();
    assert.ok(doc);
    assert.equal(doc.messages.length, 2);
    assert.equal(doc.messages[1].content.text, "Second message");
  });

  it("does not store duplicate messageId twice", async () => {
    const messageId = crypto.randomUUID();
    const body = {
      results: [
        sampleTextResult({
          messageId,
          from: PHONE_ROUTED.replace("+", ""),
          text: "Once"
        })
      ]
    };
    const res1 = await postInbound(body);
    const res2 = await postInbound(body);
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);

    const docs = await WhatsappConversation.find({ "messages.messageId": messageId }).lean();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].messages.filter((m) => m.messageId === messageId).length, 1);
  });

  it("returns 401 when signature is invalid", async () => {
    process.env.INFOBIP_WEBHOOK_SECRET = SECRET;
    const body = { results: [sampleTextResult({ text: "x" })] };
    const res = await postInbound(body, { signature: "deadbeef" });
    assert.equal(res.status, 401);
  });

  it("persists audio url and mime type without text", async () => {
    const messageId = crypto.randomUUID();
    const body = {
      results: [
        {
          messageId,
          from: PHONE_MEDIA.replace("+", ""),
          receivedAt: new Date().toISOString(),
          message: {
            type: "AUDIO",
            url: "https://api.infobip.com/media/foo",
            mimeType: "audio/ogg"
          }
        }
      ]
    };
    const res = await postInbound(body);
    assert.equal(res.status, 200);

    const doc = await WhatsappConversation.findOne({
      businessId: "_unrouted",
      customerPhone: PHONE_MEDIA,
      "messages.messageId": messageId
    }).lean();
    assert.ok(doc);
    const m = doc.messages.find((x) => x.messageId === messageId);
    assert.equal(m.type, "audio");
    assert.equal(m.content.mediaUrl, "https://api.infobip.com/media/foo");
    assert.equal(m.content.mediaMimeType, "audio/ogg");
    assert.equal(m.content.text, undefined);
  });
});

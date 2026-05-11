/**
 * POST /api/webhooks/infobip/inbound — Infobip inbound WhatsApp (BOO-INFOBIP-INBOUND-WEBHOOK-1A)
 * @see https://www.infobip.com/docs/cpaas-x/subscriptions-management
 */
import crypto from "crypto";
import express from "express";
import { WhatsappConversation } from "../../models/WhatsappConversation.js";
import { identifyBusiness } from "../../services/whatsappBusinessRouter.js";
import { normalizePhoneNumber } from "../../utils/businessRouteHelpers.js";

const router = express.Router();

const ALLOWED_TYPES = new Set([
  "text",
  "audio",
  "image",
  "document",
  "video",
  "location",
  "sticker",
  "unknown"
]);

function normalizeMessageType(t) {
  const u = String(t || "unknown").toLowerCase();
  if (ALLOWED_TYPES.has(u)) return u;
  return "unknown";
}

function extractText(message) {
  if (!message) return undefined;
  const raw = message.text;
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw.text != null) return String(raw.text);
  return undefined;
}

function extractMediaUrl(message) {
  if (!message) return undefined;
  return message.url || message.mediaUrl;
}

function extractMimeType(message) {
  if (!message) return undefined;
  return message.mimeType || message.mediaMimeType;
}

function extractDurationSeconds(message) {
  if (!message) return undefined;
  const d = message.duration ?? message.durationSeconds;
  if (d == null) return undefined;
  const n = Number(d);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Infobip WhatsApp inbound: Meta Cloud API convention — `X-Hub-Signature: SHA256=<hex>` over raw body (HMAC-SHA256).
 */
function verifyInfobipWebhookSignature(req) {
  const signatureHeader = req.headers["x-hub-signature"];
  const secret = process.env.INFOBIP_WEBHOOK_SECRET;
  if (!signatureHeader || !secret || !req.rawBody) {
    return false;
  }
  try {
    const expectedSignature = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
    const receivedHex = String(signatureHeader).trim().replace(/^SHA256=/i, "");
    const receivedBuf = Buffer.from(receivedHex.toLowerCase(), "utf8");
    const expectedBuf = Buffer.from(expectedSignature.toLowerCase(), "utf8");
    if (receivedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(receivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

function normalizeInboundEntries(body) {
  const results = Array.isArray(body?.results) ? body.results : [];
  const out = [];
  for (const result of results) {
    const messageId = result?.messageId;
    if (!messageId) continue;
    const fromRaw = result.from ?? result.sender;
    const customerPhone = normalizePhoneNumber(fromRaw);
    if (!customerPhone) continue;

    const msg = result.message || {};
    const type = normalizeMessageType(msg.type);
    const text = extractText(msg);

    out.push({
      messageId: String(messageId),
      customerPhone,
      customerName: result.contact?.name || result.contactName,
      receivedAt: result.receivedAt ? new Date(result.receivedAt) : new Date(),
      type,
      text,
      mediaUrl: extractMediaUrl(msg),
      mediaMimeType: extractMimeType(msg),
      durationSeconds: extractDurationSeconds(msg),
      rawResult: result
    });
  }
  return out;
}

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

router.post("/inbound", async (req, res) => {
  try {
    if (!verifyInfobipWebhookSignature(req)) {
      console.warn("[INFOBIP-INBOUND] Invalid or missing webhook signature");
      return res.status(401).end();
    }

    const entries = normalizeInboundEntries(req.body);
    for (const entry of entries) {
      const { messageId } = entry;

      const dup = await WhatsappConversation.findOne({ "messages.messageId": messageId }).lean();
      if (dup) {
        console.log(`[INFOBIP-INBOUND] Duplicate messageId ${messageId}, skipping`);
        continue;
      }

      const { businessId, cleanedText } = await identifyBusiness(entry.text, entry.customerPhone);

      const messageDoc = {
        messageId,
        direction: "inbound",
        type: entry.type,
        content: {
          text: entry.type === "text" ? cleanedText : undefined,
          mediaUrl: entry.mediaUrl,
          mediaMimeType: entry.mediaMimeType,
          durationSeconds: entry.durationSeconds
        },
        rawPayload: entry.rawResult,
        createdAt: entry.receivedAt
      };

      try {
        await WhatsappConversation.findOneAndUpdate(
          { businessId, customerPhone: entry.customerPhone },
          {
            $setOnInsert: {
              businessId,
              customerPhone: entry.customerPhone,
              startedAt: new Date()
            },
            $push: { messages: messageDoc },
            $set: {
              lastMessageAt: new Date(),
              windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              ...(entry.customerName ? { customerName: entry.customerName } : {})
            }
          },
          { upsert: true, new: true }
        );
      } catch (err) {
        if (isDuplicateKeyError(err)) {
          console.log(`[INFOBIP-INBOUND] Duplicate messageId ${messageId} (index), skipping`);
          continue;
        }
        throw err;
      }

      console.log(
        `[INFOBIP-INBOUND] Persisted ${entry.type} from ${entry.customerPhone} → ${businessId}`
      );
    }

    return res.status(200).end();
  } catch (err) {
    console.error("[INFOBIP-INBOUND] Handler error:", err);
    return res.status(200).end();
  }
});

export default router;

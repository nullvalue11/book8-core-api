/**
 * Twilio inbound SMS webhook: CANCEL / HELP / STATUS + two-way SMS booking (LLM).
 * POST /api/twilio/inbound-sms (form-urlencoded: From, To, Body)
 */

import express from "express";
import twilio from "twilio";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { Booking } from "../../models/Booking.js";
import { sendCancellation } from "../../services/emailService.js";
import {
  deleteGcalEvent,
  resolveCalendarProviderForBusiness,
  updateGcalEvent
} from "../../services/gcalService.js";
import { cancelUpcomingBookingForPhone } from "../../services/smsBookingCancellation.js";
import {
  normalizeE164,
  handleSmsBookingMessage,
  getHelpReply,
  getStatusReply
} from "../../services/smsBookingConversation.js";

const router = express.Router();
const authToken = process.env.TWILIO_AUTH_TOKEN;

function twiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;
}

function escapeXml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

router.post(
  "/inbound-sms",
  express.urlencoded({ extended: false }),
  (req, res) => {
    if (!authToken) {
      return res.status(503).set("Content-Type", "text/xml").send(twiml("Service temporarily unavailable."));
    }

    const signature = req.headers["x-twilio-signature"];
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const url = `${protocol}://${host}${req.originalUrl}`;
    const isValid = twilio.validateRequest(authToken, signature, url, req.body);

    if (!isValid) {
      console.warn("[inbound-sms] Twilio signature validation failed — check URL/proxy and TWILIO_AUTH_TOKEN");
      return res.status(403).set("Content-Type", "text/plain").send("Forbidden");
    }

    const from = normalizeE164(req.body.From);
    const to = normalizeE164(req.body.To);
    const rawBody = (req.body.Body || "").trim();
    const upper = rawBody.toUpperCase();

    const sendReply = (message) => {
      res.set("Content-Type", "text/xml").send(twiml(message));
    };

    const sendEmpty = () => {
      res.set("Content-Type", "text/xml").send('<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>');
    };

    (async () => {
      const business = await Business.findOne({ assignedTwilioNumber: to }).lean();
      if (!business) {
        console.warn("[inbound-sms] No business found for Twilio number:", to);
        sendEmpty();
        return;
      }

      // --- Legacy exact cancel phrase (kept for existing flows) ---
      if (upper === "CANCEL BOOKING") {
        const { reply } = await cancelUpcomingBookingForPhone(business, from);
        sendReply(reply);
        return;
      }

      // --- Short commands (no LLM) ---
      if (upper === "CANCEL") {
        const { reply } = await cancelUpcomingBookingForPhone(business, from);
        sendReply(reply);
        return;
      }

      if (upper === "HELP" || upper === "INFO") {
        sendReply(getHelpReply(business));
        return;
      }

      if (upper === "STATUS") {
        sendReply(await getStatusReply(business, from));
        return;
      }

      // --- Two-way SMS booking (LLM) when configured ---
      if (process.env.OPENAI_API_KEY && rawBody.length > 0) {
        try {
          const reply = await handleSmsBookingMessage(business, from, rawBody);
          sendReply(reply);
          return;
        } catch (err) {
          console.error("[inbound-sms] SMS booking error:", err);
          sendReply("Sorry—something went wrong. Please call us to book.");
          return;
        }
      }

      const defaultReply =
        getHelpReply(business) +
        (to ? ` Call: ${to}.` : "");
      sendReply(defaultReply);
      if (rawBody && upper !== "HELP") {
        console.log("[inbound-sms] Inbound message (no OPENAI / fallback):", { from, to, body: rawBody });
      }
    })().catch((err) => {
      console.error("[inbound-sms] Error:", err);
      if (!res.headersSent) {
        sendReply("Something went wrong. Please call us to cancel or reschedule.");
      }
    });
  }
);

export default router;

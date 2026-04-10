/**
 * Twilio inbound SMS webhook: CANCEL / HELP / STATUS + two-way SMS booking (LLM).
 * POST /api/twilio/inbound-sms (form-urlencoded: From, To, Body)
 */

import express from "express";
import twilio from "twilio";
import { Business } from "../../models/Business.js";
import {
  cancelUpcomingBookingForPhone,
  confirmSmsCancelForPhone
} from "../../services/smsBookingCancellation.js";
import {
  normalizeE164,
  handleSmsBookingMessage,
  getHelpReply,
  getStatusReply,
  resetAndGreetSmsConversation
} from "../../services/smsBookingConversation.js";
import { isChannelAllowed } from "../config/plans.js";
import { maskPhone } from "../utils/maskPhone.js";
import { trialDeniedPublicChannel } from "../utils/trialLifecycle.js";

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
      const bodyStr = req.body.Body != null ? String(req.body.Body) : "";
      console.log("[inbound-sms] Received:", {
        From: maskPhone(req.body.From),
        To: maskPhone(req.body.To),
        bodyLength: bodyStr.length
      });

      const business = await Business.findOne({ assignedTwilioNumber: to }).lean();
      if (!business) {
        console.warn("[inbound-sms] No business found for Twilio number:", maskPhone(to));
        sendEmpty();
        return;
      }

      const trialBlock = trialDeniedPublicChannel(business);
      if (trialBlock) {
        sendReply(
          "This number is temporarily unavailable for SMS. Please call the business or visit their booking page online."
        );
        return;
      }

      const plan = business.plan || "starter";
      const smsChannelOk = isChannelAllowed(plan, "sms");
      const smsBookingBlockedReply = `Thanks for reaching out! SMS booking isn't available on this business's current plan. You can book online at https://book8.io/b/${encodeURIComponent(
        business.handle || business.id || "book"
      )}`;

      // NOTE: CANCEL and CANCEL BOOKING are allowed regardless of plan tier.
      // A customer may have booked while the business was on a higher plan.
      // Cancellation should always be available.
      // BOO-45A: confirm fee warning step
      if (upper === "CONFIRM CANCEL") {
        const { reply } = await confirmSmsCancelForPhone(business, from);
        sendReply(reply);
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
        if (!smsChannelOk) {
          sendReply(smsBookingBlockedReply);
          return;
        }
        sendReply(getHelpReply(business));
        return;
      }

      if (upper === "STATUS") {
        if (!smsChannelOk) {
          sendReply("To check your booking status, visit: https://www.book8.io");
          return;
        }
        sendReply(await getStatusReply(business, from));
        return;
      }

      if (upper === "RESET" || upper === "START OVER" || upper === "STARTOVER") {
        const reply = await resetAndGreetSmsConversation(business, from);
        sendReply(reply);
        return;
      }

      // --- Two-way SMS booking (state machine by default; LLM if USE_LLM_SMS + OPENAI_API_KEY) ---
      if (rawBody.length > 0) {
        if (!smsChannelOk) {
          sendReply(`Thanks for reaching out! SMS booking isn't available on this business's current plan. Book online at https://book8.io/b/${encodeURIComponent(
            business.handle || business.id || "book"
          )}`);
          return;
        }
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

      if (!smsChannelOk) {
        sendReply(smsBookingBlockedReply);
        return;
      }
      const defaultReply =
        getHelpReply(business) +
        (to ? ` Call: ${to}.` : "");
      sendReply(defaultReply);
      if (rawBody && upper !== "HELP") {
        console.log("[inbound-sms] Inbound message (empty body path / fallback):", {
          from: maskPhone(from),
          to: maskPhone(to),
          bodyLength: rawBody.length
        });
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

/**
 * Twilio inbound SMS webhook: handle CANCEL BOOKING replies and generic replies.
 * POST /api/twilio/inbound-sms (form-urlencoded: From, To, Body)
 */

import express from "express";
import twilio from "twilio";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { Booking } from "../../models/Booking.js";
import { sendCancellation } from "../../services/emailService.js";

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

function formatSlotInTz(slotStart, timezone) {
  const tz = timezone || "America/Toronto";
  const d = new Date(slotStart);
  const dateStr = d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz
  });
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz
  });
  return { dateStr, timeStr };
}

router.post(
  "/inbound-sms",
  express.urlencoded({ extended: false }),
  (req, res) => {
    if (!authToken) {
      return res.status(503).set("Content-Type", "text/xml").send(twiml("Service temporarily unavailable."));
    }

    const signature = req.headers["x-twilio-signature"];
    // Use forwarded headers so signature matches the URL Twilio actually called (e.g. https on Render).
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    const url = `${protocol}://${host}${req.originalUrl}`;
    const isValid = twilio.validateRequest(authToken, signature, url, req.body);

    if (!isValid) {
      console.warn("[inbound-sms] Twilio signature validation failed — check URL/proxy and TWILIO_AUTH_TOKEN");
      return res.status(403).set("Content-Type", "text/plain").send("Forbidden");
    }

    const from = req.body.From;
    const to = req.body.To;
    const body = (req.body.Body || "").trim().toUpperCase();

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

      if (body === "CANCEL BOOKING") {
        const now = new Date().toISOString();
        const booking = await Booking.findOne({
          businessId: business.id,
          "customer.phone": from,
          status: "confirmed",
          "slot.start": { $gt: now }
        })
          .sort({ "slot.start": 1 })
          .lean();

        if (booking) {
          await Booking.updateOne(
            { id: booking.id },
            {
              $set: {
                status: "cancelled",
                cancelledAt: new Date(),
                cancellationMethod: "sms"
              }
            }
          );

          const tz = business.timezone || "America/Toronto";
          const { dateStr, timeStr } = formatSlotInTz(booking.slot.start, tz);
          let serviceDisplay = booking.serviceId || "Appointment";
          try {
            const svc = await Service.findOne({ businessId: business.id, serviceId: booking.serviceId }).lean();
            if (svc?.name) serviceDisplay = svc.name;
          } catch {
            // keep serviceDisplay from booking
          }
          const businessName = business.name || business.id;

          const replyMsg = `Your ${serviceDisplay} appointment at ${businessName} on ${dateStr} at ${timeStr} has been cancelled. If you need to rebook, just call us!`;
          sendReply(replyMsg);
          console.log("[inbound-sms] Booking cancelled:", booking.id);

          if (booking.customer?.email) {
            const serviceForEmail = await Service.findOne({ businessId: business.id, serviceId: booking.serviceId }).lean();
            sendCancellation(booking, business, serviceForEmail || { name: serviceDisplay }, booking.customer).catch((err) =>
              console.error("[inbound-sms] Cancellation email failed:", err.message)
            );
          }
          return;
        }
      }

      const defaultReply =
        "Thanks for your message! To cancel your upcoming appointment, reply UNDO. To book or reschedule, call " +
        (to || "us") +
        ".";
      sendReply(defaultReply);
      if (body && body !== "CANCEL BOOKING") {
        console.log("[inbound-sms] Inbound message (no CANCEL BOOKING):", { from, to, body: req.body.Body });
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

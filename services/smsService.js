// services/smsService.js
// Thin wrapper around Twilio SMS API

import twilio from "twilio";
import { maskPhone } from "../src/utils/maskPhone.js";
import { getSmsTemplate } from "./templates/smsTemplates.js";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

let twilioClient = null;

function getClient() {
  if (!twilioClient) {
    if (!accountSid || !authToken) {
      console.warn("[smsService] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set — SMS disabled");
      return null;
    }
    twilioClient = twilio(accountSid, authToken);
  }
  return twilioClient;
}

/**
 * Send an SMS message.
 * @param {object} params
 * @param {string} params.to - Recipient phone number (E.164 format)
 * @param {string} params.from - Sender phone number (must be a Twilio number you own)
 * @param {string} params.body - Message text
 * @returns {Promise<{ ok: boolean, messageSid?: string, error?: string }>}
 */
export async function sendSMS({ to, from, body }) {
  const client = getClient();
  if (!client) {
    console.warn("[smsService] Twilio client not available — skipping SMS");
    return { ok: false, error: "Twilio not configured" };
  }

  if (!to || !from || !body) {
    console.warn("[smsService] Missing required fields:", { to: !!to, from: !!from, body: !!body });
    return { ok: false, error: "Missing to, from, or body" };
  }

  try {
    const message = await client.messages.create({
      to,
      from,
      body
    });

    console.log("[smsService] SMS sent:", {
      messageSid: message.sid,
      to: maskPhone(to),
      from: maskPhone(from),
      status: message.status
    });

    return { ok: true, messageSid: message.sid };
  } catch (err) {
    console.error("[smsService] Error sending SMS:", {
      to: maskPhone(to),
      from: maskPhone(from),
      error: err.message,
      code: err.code
    });
    return { ok: false, error: err.message };
  }
}

/**
 * Format a booking into a confirmation SMS message (BOO-34A short copy; locale + CANCEL BOOKING).
 * @param {object} params
 * @param {string} params.businessName - e.g. "Downtown Barber Co."
 * @param {string} params.date - e.g. "Tuesday, March 17"
 * @param {string} params.time - e.g. "2:00 PM"
 * @param {string} [params.language] - ISO 639-1 booking language (en, fr, es, ar, …)
 * @param {string} [params.serviceName] - reserved for callers; confirmation template uses businessName/date/time only
 * @param {string} [params.customerName] - reserved for callers; not used in short confirmation copy
 * @returns {string}
 */
export function formatConfirmationSMS({ serviceName, businessName, date, time, customerName, language }) {
  const template = getSmsTemplate(language, "confirmation");
  return template({
    serviceName,
    businessName,
    date,
    time,
    customerName: customerName || ""
  });
}

/**
 * BOO-98A reschedule notice (multilingual).
 *
 * BOO-SMS-COMPLIANCE-1A: now also includes the rescheduled service name and a STOP
 * opt-out hint. Callers should pass `serviceName` + a short composite `date` string
 * (e.g. "Fri May 15" / "15 mai"). Legacy callers can still pass the old
 * { newDay, newDate, newTime } trio and we'll compose them.
 */
export function formatRescheduleSMS({
  businessName,
  serviceName,
  date,
  time,
  newDay,
  newDate,
  newTime,
  language
}) {
  const template = getSmsTemplate(language, "reschedule");
  const composedDate =
    date != null && date !== ""
      ? date
      : [newDay, newDate].filter(Boolean).join(" ").trim();
  const composedTime = time != null && time !== "" ? time : newTime || "";
  return template({
    businessName: businessName || "Book8",
    serviceName: serviceName || "appointment",
    date: composedDate,
    time: composedTime
  });
}

/**
 * Format a reminder SMS message.
 * @param {object} params
 * @returns {string}
 */
/**
 * BOO-58A: post-appointment review request SMS (multilingual).
 */
export function formatReviewRequestSMS({ serviceName, businessName, link, language }) {
  const template = getSmsTemplate(language, "reviewRequest");
  return template({
    serviceName: serviceName || "visit",
    businessName: businessName || "us",
    link: link || ""
  });
}

/**
 * BOO-SMS-COMPLIANCE-1A: reminder SMS (multilingual + STOP opt-out keyword).
 * `language` defaults to English to preserve previous behavior.
 */
export function formatReminderSMS({
  serviceName,
  businessName,
  date,
  time,
  isOneHour,
  isThirtyMinutes,
  language
}) {
  const safeService = serviceName || "appointment";
  const safeBusiness = businessName || "Book8";
  const type = isThirtyMinutes
    ? "reminderThirtyMin"
    : isOneHour
      ? "reminderOneHour"
      : "reminder";
  const template = getSmsTemplate(language, type);
  return template({
    serviceName: safeService,
    businessName: safeBusiness,
    date: date || "",
    time: time || ""
  });
}


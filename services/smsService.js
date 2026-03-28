// services/smsService.js
// Thin wrapper around Twilio SMS API

import twilio from "twilio";

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
      to,
      from,
      status: message.status
    });

    return { ok: true, messageSid: message.sid };
  } catch (err) {
    console.error("[smsService] Error sending SMS:", {
      to,
      from,
      error: err.message,
      code: err.code
    });
    return { ok: false, error: err.message };
  }
}

/**
 * Format a booking into a confirmation SMS message.
 * @param {object} params
 * @param {string} params.serviceName - e.g. "Men's Haircut"
 * @param {string} params.businessName - e.g. "Downtown Barber Co."
 * @param {string} params.date - e.g. "Tuesday, March 17"
 * @param {string} params.time - e.g. "2:00 PM"
 * @param {string} params.customerName - e.g. "John"
 * @returns {string}
 */
// TODO: Localize SMS confirmations based on booking.language (see bookingService).
// For now, all confirmations sent in English.
export function formatConfirmationSMS({ serviceName, businessName, date, time, customerName }) {
  return [
    `✅ Booked! ${serviceName} on ${date} at ${time} at ${businessName}.`,
    `Add to calendar: check your confirmation email for Google, Outlook, or Apple links.`,
    `See you then${customerName ? `, ${customerName}` : ""}!`,
    "",
    `Need to cancel? Reply CANCEL BOOKING.`
  ].join("\n");
}

/**
 * Format a reminder SMS message.
 * @param {object} params
 * @returns {string}
 */
export function formatReminderSMS({ serviceName, businessName, date, time, isOneHour, isThirtyMinutes }) {
  if (isThirtyMinutes) {
    return `Your ${serviceName} appointment at ${businessName} starts in 30 minutes. See you soon!`;
  }
  if (isOneHour) {
    return `Your ${serviceName} appointment at ${businessName} starts in 1 hour. See you soon!`;
  }
  return [
    `⏰ Reminder: Appointment tomorrow`,
    `${serviceName} with ${businessName}`,
    `📅 ${date} at ${time}`,
    "",
    `Reply CANCEL BOOKING to cancel your appointment.`
  ].join("\n");
}


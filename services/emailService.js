// services/emailService.js
// Resend-based email confirmations and reminders. Fire-and-forget; no-op if RESEND_API_KEY not set.

import { Resend } from "resend";
import { generateCalendarLinks } from "../utils/calendarLinks.js";

const apiKey = process.env.RESEND_API_KEY;
const defaultFrom = "Book8 <noreply@book8.io>";

let resend = null;
if (apiKey) {
  resend = new Resend(apiKey);
  console.log("[emailService] Resend initialized, sending from:", process.env.RESEND_FROM);
} else {
  console.warn("[emailService] RESEND_API_KEY not set — emails disabled");
}

function getFrom() {
  return process.env.RESEND_FROM || defaultFrom;
}

/**
 * Format slot start in business timezone for display.
 */
function formatDateAndTime(slotStart, timezone) {
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

/**
 * Base HTML layout: max-width 600px, centered, mobile-friendly.
 */
function baseHtml(content) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
${content}
<p style="margin-top:32px;font-size:12px;color:#888;">Powered by Book8 AI</p>
</div></body></html>`;
}

/**
 * Send booking confirmation email. Fire-and-forget safe; no-op if Resend not configured.
 * @param {object} booking - booking doc (id, slot, customer, serviceId, businessId)
 * @param {object} business - business doc (name, timezone)
 * @param {object} service - service doc (name)
 * @param {object} customer - customer (name, email)
 */
export async function sendConfirmation(booking, business, service, customer) {
  if (!resend || !customer?.email) return;
  console.log("[emailService] Sending confirmation email to:", customer.email);
  const { dateStr, timeStr } = formatDateAndTime(booking.slot?.start, business?.timezone);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const firstName = customer?.name?.split(" ")[0] || "";

  const subject = `✅ Booking Confirmed — ${serviceName} at ${businessName}`;
  const slotStart = booking.slot?.start;
  let slotEnd = booking.slot?.end;
  if (slotStart && !slotEnd) {
    slotEnd = new Date(new Date(slotStart).getTime() + 60 * 60 * 1000).toISOString();
  }
  const emailDescription = [
    `${serviceName} at ${businessName}`,
    `${dateStr} at ${timeStr}`,
    booking.id ? `Booking ref: ${booking.id}` : null,
    "Booked via Book8 AI"
  ]
    .filter(Boolean)
    .join("\n");

  const { googleUrl, outlookUrl, icsDataUrl } = generateCalendarLinks({
    title: `${serviceName} — ${businessName}`,
    start: slotStart,
    end: slotEnd,
    description: emailDescription,
    location: businessName
  });

  const btn =
    "display:inline-block;padding:10px 20px;margin:6px;background:#1a1a2e;border:1px solid #333;border-radius:8px;color:#fff;text-decoration:none;font-size:14px;";

  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    <p style="margin:0 0 16px 0;color:#22c55e;font-weight:600;">Confirmed</p>
    <p style="margin:0 0 8px 0;"><strong>${escapeHtml(serviceName)}</strong></p>
    <p style="margin:0 0 16px 0;">${dateStr} at ${timeStr}</p>
    <p style="margin:0 0 16px 0;">See you then${firstName ? `, ${escapeHtml(firstName)}` : ""}!</p>
    <div style="margin:24px 0;text-align:center;">
      <p style="color:#94A3B8;font-size:14px;margin-bottom:12px;">Add to your calendar</p>
      <a href="${googleUrl}" style="${btn}">📅 Google Calendar</a>
      <a href="${outlookUrl}" style="${btn}">📅 Outlook</a>
      <a href="${icsDataUrl}" style="${btn}" download="book8-appointment.ics">📅 Apple / Download .ics</a>
    </div>
    <p style="margin:0 0 0 0;color:#666;font-size:14px;">Need to cancel? Text CANCEL BOOKING to your booking number, or call us to reschedule.</p>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject,
      html: baseHtml(content)
    });
    if (error) {
      console.warn("[emailService] Confirmation send failed:", error.message);
      return;
    }
    return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Confirmation error:", err.message);
  }
}

/**
 * Send reminder email. type = '24h' | '1h' | '30min'
 * @param {object} booking - booking doc
 * @param {object} business - business doc
 * @param {object} service - service doc
 * @param {object} customer - customer (name, email)
 * @param {'24h'|'1h'|'30min'} type
 */
export async function sendReminder(booking, business, service, customer, type) {
  if (!resend || !customer?.email) return;
  const tz = business?.timezone || "America/Toronto";
  const { dateStr, timeStr } = formatDateAndTime(booking.slot?.start, tz);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";

  let subject;
  let bodyText;
  let headerText;
  if (type === "30min") {
    subject = `Starting soon: ${serviceName} at ${businessName} in 30 minutes`;
    headerText = "Starting in 30 minutes";
    bodyText = `Your ${serviceName} appointment at ${businessName} starts in 30 minutes! See you at ${timeStr}!`;
  } else if (type === "1h") {
    subject = `Starting soon: ${serviceName} at ${businessName} in 1 hour`;
    headerText = "Starting in 1 hour";
    bodyText = `Your ${serviceName} appointment at ${businessName} starts in 1 hour at ${timeStr}. See you soon!`;
  } else {
    subject = `Reminder: ${serviceName} at ${businessName} tomorrow`;
    headerText = "Appointment tomorrow";
    bodyText = `Just a reminder — your ${serviceName} appointment at ${businessName} is tomorrow at ${timeStr}. See you then!`;
  }

  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    <p style="margin:0 0 16px 0;color:#2563eb;font-weight:600;">${headerText}</p>
    <p style="margin:0 0 16px 0;">${escapeHtml(bodyText)}</p>
    <p style="margin:0 0 0 0;color:#666;font-size:14px;">Need to cancel? Text CANCEL BOOKING to your booking number, or call us to reschedule.</p>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject,
      html: baseHtml(content)
    });
    if (error) {
      console.warn("[emailService] Reminder send failed:", error.message);
      return;
    }
    return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Reminder error:", err.message);
  }
}

/**
 * Send booking cancellation email. Fire-and-forget; no-op if Resend not configured or no email.
 * @param {object} booking - booking doc (slot, serviceId, businessId, customer)
 * @param {object} business - business doc (name, timezone, assignedTwilioNumber)
 * @param {object} service - service doc (name)
 * @param {object} customer - customer (name, email)
 */
export async function sendCancellation(booking, business, service, customer) {
  if (!resend || !customer?.email) return;
  const { dateStr, timeStr } = formatDateAndTime(booking.slot?.start, business?.timezone);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const callNumber = business?.assignedTwilioNumber ? `call ${business.assignedTwilioNumber}` : "call us";

  const subject = `Booking Cancelled — ${serviceName} at ${businessName}`;
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    <p style="margin:0 0 16px 0;color:#b91c1c;font-weight:600;">Booking cancelled</p>
    <p style="margin:0 0 8px 0;">Your <strong>${escapeHtml(serviceName)}</strong> appointment at ${escapeHtml(businessName)} on ${dateStr} at ${timeStr} has been cancelled.</p>
    <p style="margin:0 0 0 0;color:#666;font-size:14px;">To rebook or reschedule, ${callNumber}.</p>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject,
      html: baseHtml(content)
    });
    if (error) {
      console.warn("[emailService] Cancellation send failed:", error.message);
      return;
    }
    return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Cancellation error:", err.message);
  }
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


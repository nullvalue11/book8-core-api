// BOO-59A: SMS + email for waitlist flows
import { sendSMS } from "./smsService.js";
import { getSmsTemplate } from "./templates/smsTemplates.js";
import {
  sendWaitlistJoinEmail,
  sendWaitlistSlotOpenEmail,
  sendWaitlistExpiredEmail
} from "./emailService.js";
import { isFeatureAllowed } from "./planLimits.js";

export function publicBookingPageUrl(business) {
  const origin = (process.env.PUBLIC_APP_ORIGIN || "https://www.book8.io").replace(/\/$/, "");
  const handle = business?.handle || business?.id || business?.businessId || "";
  return `${origin}/b/${encodeURIComponent(handle)}`;
}

export async function sendWaitlistJoinNotifications(business, entry, { serviceName, bookingLink }) {
  const lang = entry.language || "en";
  const tpl = getSmsTemplate(lang, "waitlistJoin");
  const body = tpl({
    businessName: business.name || business.id,
    serviceName: serviceName || "a service"
  });

  const fromNumber = business.assignedTwilioNumber;
  const plan = business.plan || "starter";
  if (entry.customer?.phone && fromNumber && isFeatureAllowed(plan, "smsConfirmations")) {
    await sendSMS({
      to: entry.customer.phone,
      from: fromNumber,
      body
    });
  }

  await sendWaitlistJoinEmail({
    customer: entry.customer,
    business,
    serviceName: serviceName || "Appointment",
    bookingLink,
    language: lang
  });
}

/**
 * @param {object} params
 * @param {string} params.dateStr
 * @param {string} params.timeStr
 * @param {string} params.bookLink - deep link to book the offered slot
 */
export async function sendWaitlistSlotAvailableNotifications(
  business,
  entry,
  { serviceName, dateStr, timeStr, bookLink }
) {
  const lang = entry.language || "en";
  const tpl = getSmsTemplate(lang, "waitlistSlotOpen");
  const body = tpl({
    businessName: business.name || business.id,
    serviceName: serviceName || "Appointment",
    date: dateStr,
    time: timeStr,
    link: bookLink
  });

  const fromNumber = business.assignedTwilioNumber;
  const plan = business.plan || "starter";
  if (entry.customer?.phone && fromNumber && isFeatureAllowed(plan, "smsConfirmations")) {
    await sendSMS({ to: entry.customer.phone, from: fromNumber, body });
  }

  await sendWaitlistSlotOpenEmail({
    customer: entry.customer,
    business,
    serviceName: serviceName || "Appointment",
    date: dateStr,
    time: timeStr,
    link: bookLink,
    language: lang
  });
}

export async function sendWaitlistExpiredNotifications(business, entry, { serviceName, bookingLink }) {
  const lang = entry.language || "en";
  const tpl = getSmsTemplate(lang, "waitlistExpired");
  const body = tpl({
    businessName: business.name || business.id,
    serviceName: serviceName || "Appointment",
    bookingLink
  });

  const fromNumber = business.assignedTwilioNumber;
  const plan = business.plan || "starter";
  if (entry.customer?.phone && fromNumber && isFeatureAllowed(plan, "smsConfirmations")) {
    await sendSMS({ to: entry.customer.phone, from: fromNumber, body });
  }

  await sendWaitlistExpiredEmail({
    customer: entry.customer,
    business,
    serviceName: serviceName || "Appointment",
    bookingLink,
    language: lang
  });
}

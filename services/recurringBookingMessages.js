// BOO-60A: SMS + email for recurring booking flows
import { sendSMS } from "./smsService.js";
import { getSmsTemplate } from "./templates/smsTemplates.js";
import {
  sendRecurringInitialBookingEmail,
  sendRecurringNextBookingEmail,
  sendRecurringUnavailableEmail
} from "./emailService.js";
import { isFeatureAllowed } from "./planLimits.js";
import { publicBookingPageUrl } from "./waitlistMessages.js";
import { Service } from "../models/Service.js";

export const sendRecurringInitialConfirmations = {
  buildSms({ serviceName, businessName, date, time, occurrence, total, language }) {
    const tpl = getSmsTemplate(language || "en", "recurringInitial");
    return tpl({
      serviceName,
      businessName,
      date,
      time,
      occurrence,
      total
    });
  },
  sendEmail(booking, business, service, customer) {
    return sendRecurringInitialBookingEmail(booking, business, service, customer);
  }
};

export const sendRecurringNextConfirmations = {
  buildSms({ serviceName, businessName, date, time, language }) {
    const tpl = getSmsTemplate(language || "en", "recurringNext");
    return tpl({ serviceName, businessName, date, time });
  },
  sendEmail(booking, business, service, customer) {
    return sendRecurringNextBookingEmail(booking, business, service, customer);
  }
};

/**
 * When the next occurrence could not be auto-booked (slot taken).
 * @param {object} business
 * @param {object} parentBooking - lean or doc
 * @param {string} dateLabel - display date for SMS/email
 */
export async function sendRecurringSlotUnavailableNotifications(business, parentBooking, dateLabel) {
  const lang = parentBooking.language || "en";
  const link = publicBookingPageUrl(business);
  let serviceName = parentBooking.serviceId || "Appointment";
  try {
    const svc = await Service.findOne({
      businessId: parentBooking.businessId,
      serviceId: parentBooking.serviceId
    }).lean();
    if (svc?.name) serviceName = svc.name;
  } catch {
    // keep fallback
  }
  const businessName = business?.name || business?.id || parentBooking.businessId;
  const tpl = getSmsTemplate(lang, "recurringUnavailable");
  const body = tpl({
    serviceName,
    businessName,
    date: dateLabel,
    link
  });
  const fromNumber = business?.assignedTwilioNumber;
  const plan = business?.plan || "starter";
  if (parentBooking.customer?.phone && fromNumber && isFeatureAllowed(plan, "smsConfirmations")) {
    await sendSMS({
      to: parentBooking.customer.phone,
      from: fromNumber,
      body
    });
  }
  if (isFeatureAllowed(plan, "emailConfirmations")) {
    await sendRecurringUnavailableEmail(parentBooking, business, { name: serviceName }, parentBooking.customer, {
      dateLabel,
      bookingLink: link
    });
  }
}

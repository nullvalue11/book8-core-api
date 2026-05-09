import {
  sendSMS,
  formatConfirmationSMS,
  formatReminderSMS
} from "../smsService.js";
import { getSmsTemplate } from "../templates/smsTemplates.js";
import { MessagingProvider } from "./MessagingProvider.js";

function customerFirstName(customer) {
  const n = customer?.name ? String(customer.name).trim() : "";
  if (!n) return "";
  return n.split(/\s+/)[0] || n;
}

export class TwilioProvider extends MessagingProvider {
  async sendBookingConfirmation(business, customer, ctx = {}) {
    const fromNumber = business?.assignedTwilioNumber;
    const to = customer?.phone;
    if (!to || !fromNumber) {
      return { ok: false, error: "Missing customer phone or assignedTwilioNumber" };
    }

    const body =
      ctx.smsBodyOverride ||
      formatConfirmationSMS({
        serviceName: ctx.serviceName || "Appointment",
        businessName: ctx.businessName || business?.name || business?.id || "",
        date: ctx.slotLocalDate || "",
        time: ctx.slotLocalTime || "",
        customerName: customerFirstName(customer),
        language: ctx.language || customer?.language || "en"
      });

    return sendSMS({ to, from: fromNumber, body });
  }

  async sendBookingReminder(business, customer, ctx = {}) {
    const fromNumber = business?.assignedTwilioNumber;
    const to = customer?.phone;
    if (!to || !fromNumber) {
      return { ok: false, error: "Missing customer phone or assignedTwilioNumber" };
    }

    const body =
      ctx.smsBodyOverride ||
      formatReminderSMS({
        serviceName: ctx.serviceName || "Appointment",
        businessName: ctx.businessName || business?.name || business?.id || "",
        date: ctx.slotLocalDate || "",
        time: ctx.slotLocalTime || "",
        isOneHour: !!ctx.isOneHour,
        isThirtyMinutes: !!ctx.isThirtyMinutes
      });

    return sendSMS({ to, from: fromNumber, body });
  }

  async sendCancelNotification(business, customer, ctx = {}) {
    const fromNumber = business?.assignedTwilioNumber;
    const to = customer?.phone;
    if (!to || !fromNumber) {
      return { ok: false, error: "Missing customer phone or assignedTwilioNumber" };
    }

    const lang = ctx.language || customer?.language || "en";
    const tpl = getSmsTemplate(lang, "cancellation");
    const body = tpl({
      serviceName: ctx.serviceName || "Appointment",
      businessName: ctx.businessName || business?.name || business?.id || "",
      date: ctx.slotLocalDate || "",
      time: ctx.slotLocalTime || "",
      customerName: customerFirstName(customer)
    });

    return sendSMS({ to, from: fromNumber, body });
  }

  async sendBookingReschedule(business, customer, ctx = {}) {
    const fromNumber = business?.assignedTwilioNumber;
    const to = customer?.phone;
    if (!to || !fromNumber) {
      return { ok: false, error: "Missing customer phone or assignedTwilioNumber" };
    }
    const body = ctx.body != null ? String(ctx.body) : "";
    if (!body) {
      return { ok: false, error: "Missing reschedule body" };
    }
    return sendSMS({ to, from: fromNumber, body });
  }
}

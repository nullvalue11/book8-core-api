import { sendWhatsAppTemplate, sendWhatsAppFreeForm } from "../infobip/infobipClient.js";
import { infobipLanguageCode } from "./bspRouting.js";
import { MessagingProvider } from "./MessagingProvider.js";

function customerFirstName(customer) {
  const n = customer?.name ? String(customer.name).trim() : "";
  if (!n) return "Customer";
  return n.split(/\s+/)[0] || n;
}

function resolveSender(business) {
  const explicit = business?.whatsappSenderNumber?.trim();
  if (explicit) return explicit;
  const fallbackFromEnv = process.env.INFOBIP_SENDER?.trim();
  return fallbackFromEnv || "";
}

export class InfobipProvider extends MessagingProvider {
  async sendBookingConfirmation(business, customer, ctx = {}) {
    const from = resolveSender(business);
    const to = customer?.phone;
    if (!to || !from) {
      console.warn("[InfobipProvider] Missing recipient phone or WhatsApp sender — skipping");
      return { ok: false, error: "Missing phone or WhatsApp sender (set whatsappSenderNumber or INFOBIP_SENDER)" };
    }

    const lang = infobipLanguageCode(ctx.language || customer?.language || "en");
    try {
      const data = await sendWhatsAppTemplate({
        from,
        to,
        templateName: "booking_confirmation",
        languageCode: lang,
        placeholders: [
          customerFirstName(customer),
          ctx.businessName || business?.name || "",
          ctx.serviceName || "Appointment",
          ctx.slotLocalDate || "",
          ctx.slotLocalTime || ""
        ]
      });
      const mid =
        data?.messages?.[0]?.messageId ||
        data?.messageId ||
        data?.bulkId ||
        "sent";
      console.log("[InfobipProvider] booking_confirmation sent:", mid);
      return { ok: true, messageSid: String(mid) };
    } catch (err) {
      console.error("[InfobipProvider] booking_confirmation failed:", err.message);
      return { ok: false, error: err.message };
    }
  }

  async sendBookingReminder(business, customer, ctx = {}) {
    const from = resolveSender(business);
    const to = customer?.phone;
    if (!to || !from) {
      return { ok: false, error: "Missing phone or WhatsApp sender" };
    }

    const lang = infobipLanguageCode(ctx.language || customer?.language || "en");
    const reminderDetail =
      ctx.reminderDetail ||
      [ctx.slotLocalDate, ctx.slotLocalTime].filter(Boolean).join(" ") ||
      "";

    try {
      const data = await sendWhatsAppTemplate({
        from,
        to,
        templateName: "booking_reminder",
        languageCode: lang,
        placeholders: [
          customerFirstName(customer),
          ctx.serviceName || "Appointment",
          reminderDetail
        ]
      });
      const mid = data?.messages?.[0]?.messageId || data?.messageId || "sent";
      console.log("[InfobipProvider] booking_reminder sent:", mid);
      return { ok: true, messageSid: String(mid) };
    } catch (err) {
      console.error("[InfobipProvider] booking_reminder failed:", err.message);
      return { ok: false, error: err.message };
    }
  }

  async sendCancelNotification(business, customer, ctx = {}) {
    const from = resolveSender(business);
    const to = customer?.phone;
    if (!to || !from) {
      return { ok: false, error: "Missing phone or WhatsApp sender" };
    }

    const lang = infobipLanguageCode(ctx.language || customer?.language || "en");
    const dateLine = ctx.slotLocalDate || "";

    try {
      const data = await sendWhatsAppTemplate({
        from,
        to,
        templateName: "booking_cancelled",
        languageCode: lang,
        placeholders: [
          customerFirstName(customer),
          ctx.serviceName || "Appointment",
          dateLine
        ]
      });
      const mid = data?.messages?.[0]?.messageId || data?.messageId || "sent";
      console.log("[InfobipProvider] booking_cancelled sent:", mid);
      return { ok: true, messageSid: String(mid) };
    } catch (err) {
      console.error("[InfobipProvider] booking_cancelled failed:", err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Outside the 24h customer window, free-form messages may be rejected by WhatsApp —
   * prefer an approved template once `booking_reschedule` exists in Meta/Infobip.
   */
  async sendBookingReschedule(business, customer, ctx = {}) {
    const from = resolveSender(business);
    const to = customer?.phone;
    if (!to || !from) {
      return { ok: false, error: "Missing phone or WhatsApp sender" };
    }
    const body = ctx.body != null ? String(ctx.body) : "";
    if (!body) {
      return { ok: false, error: "Missing reschedule body" };
    }
    try {
      const data = await sendWhatsAppFreeForm({ from, to, text: body });
      const mid =
        data?.messages?.[0]?.messageId ||
        data?.messageId ||
        data?.bulkId ||
        "sent";
      return { ok: true, messageSid: String(mid) };
    } catch (err) {
      console.error("[InfobipProvider] reschedule free-form failed:", err.message);
      return { ok: false, error: err.message };
    }
  }
}

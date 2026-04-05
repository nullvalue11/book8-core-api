// services/emailService.js
// Resend-based email confirmations and reminders. Fire-and-forget; no-op if RESEND_API_KEY not set.

import { Resend } from "resend";
import { generateCalendarLinks } from "../utils/calendarLinks.js";
import { formatSlotDateTime, normalizeLangCode } from "./localeFormat.js";
import {
  getEmailSubject,
  getEmailHeadings,
  getBookingCancelFooter,
  buildCancellationEmail,
  buildNoShowChargeEmail,
  buildCancellationWithFeeEmail,
  getBookingLanguageRaw,
  getConfirmationSlotDisplay,
  getCalendarLinkLabels,
  buildIcsEventDescription,
  getReminderEmailParts,
  buildReviewRequestEmail,
  buildWaitlistJoinEmail,
  buildWaitlistSlotOpenEmail,
  buildWaitlistExpiredEmail,
  buildRecurringInitialEmail,
  buildRecurringNextEmail,
  buildRecurringUnavailableEmail
} from "./templates/emailTemplates.js";
import { formatMoneyForLocale, resolveCurrency } from "./noShowProtection.js";

const apiKey = process.env.RESEND_API_KEY;
const defaultFrom = "Book8 AI <noreply@book8.io>";

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
 * IANA timezone for customer-facing email copy.
 * Prefer slot (booking), then weekly schedule, then business root.
 */
function resolveEmailTimezone(booking, business) {
  return (
    booking?.slot?.timezone ||
    business?.weeklySchedule?.timezone ||
    business?.timezone ||
    "America/Toronto"
  );
}

function formatDateAndTime(slotStart, timezone, language = "en") {
  return formatSlotDateTime(slotStart, timezone, language);
}

function emailHtmlLang(lang) {
  const c = normalizeLangCode(lang);
  if (c === "ar") return "ar";
  if (c === "fr") return "fr";
  if (c === "es") return "es";
  return "en";
}

/**
 * Base HTML layout: max-width 600px, centered, mobile-friendly.
 */
function baseHtml(content, { rtl = false, poweredBy = "Powered by Book8 AI", htmlLang = "en" } = {}) {
  const dirAttr = rtl ? "rtl" : "ltr";
  const styleDir = rtl ? " direction:rtl;text-align:right;" : "";
  return `<!DOCTYPE html><html lang="${escapeHtml(htmlLang)}" dir="${dirAttr}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body dir="${dirAttr}" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:24px;${styleDir}">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
${content}
<p style="margin-top:32px;font-size:12px;color:#888;">${escapeHtml(poweredBy)}</p>
</div></body></html>`;
}

/**
 * Send booking confirmation email. Fire-and-forget safe; no-op if Resend not configured.
 * @param {object} booking - booking doc (id, slot, customer, serviceId, businessId)
 * @param {object} business - business doc (name, timezone, weeklySchedule)
 * @param {object} service - service doc (name)
 * @param {object} customer - customer (name, email)
 */
export async function sendConfirmation(booking, business, service, customer) {
  if (!resend || !customer?.email) return;
  console.log("[emailService] Sending confirmation email to:", customer.email);
  const langRaw = getBookingLanguageRaw(booking) || "en";
  const lang = langRaw;
  const rtl = normalizeLangCode(lang) === "ar";
  const tz = resolveEmailTimezone(booking, business);
  const { dateStr, timeStr } = formatDateAndTime(booking.slot?.start, tz, lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const firstName = customer?.name?.split(" ")[0] || "";

  const subject = getEmailSubject(lang, serviceName, businessName);
  const headings = getEmailHeadings(lang);
  const slotLine = getConfirmationSlotDisplay(lang, dateStr, timeStr);
  const calLabels = getCalendarLinkLabels(lang);
  const slotStart = booking.slot?.start;
  let slotEnd = booking.slot?.end;
  if (slotStart && !slotEnd) {
    slotEnd = new Date(new Date(slotStart).getTime() + 60 * 60 * 1000).toISOString();
  }
  const emailDescription = buildIcsEventDescription(lang, {
    serviceName,
    businessName,
    dateStr,
    timeStr,
    bookingId: booking.id
  });

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
    <p style="margin:0 0 16px 0;color:#22c55e;font-weight:600;">${escapeHtml(headings.confirmed)}</p>
    <p style="margin:0 0 8px 0;"><strong>${escapeHtml(serviceName)}</strong></p>
    <p style="margin:0 0 16px 0;">${escapeHtml(slotLine)}</p>
    <p style="margin:0 0 16px 0;">${escapeHtml(headings.seeYou)}${firstName ? `, ${escapeHtml(firstName)}` : ""}!</p>
    <div style="margin:24px 0;text-align:center;">
      <p style="color:#94A3B8;font-size:14px;margin-bottom:12px;">${escapeHtml(headings.addCalendar)}</p>
      <a href="${googleUrl}" style="${btn}">📅 ${escapeHtml(calLabels.google)}</a>
      <a href="${outlookUrl}" style="${btn}">📅 ${escapeHtml(calLabels.outlook)}</a>
      <a href="${icsDataUrl}" style="${btn}" download="book8-appointment.ics">📅 ${escapeHtml(calLabels.apple)}</a>
    </div>
    <p style="margin:0 0 0 0;color:#666;font-size:14px;">${escapeHtml(getBookingCancelFooter(lang, business))}</p>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
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
 * @param {object} business - business doc (timezone / weeklySchedule.timezone)
 * @param {object} service - service doc
 * @param {object} customer - customer (name, email)
 * @param {'24h'|'1h'|'30min'} type
 */
export async function sendReminder(booking, business, service, customer, type) {
  if (!resend || !customer?.email) return;
  const lang = getBookingLanguageRaw(booking) || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const tz = resolveEmailTimezone(booking, business);
  const { timeStr } = formatDateAndTime(booking.slot?.start, tz, lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";

  const reminderType = type === "30min" || type === "1h" ? type : "24h";
  const { subject, headerText, bodyText } = getReminderEmailParts(lang, reminderType, {
    serviceName,
    businessName,
    timeStr
  });

  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    <p style="margin:0 0 16px 0;color:#2563eb;font-weight:600;">${escapeHtml(headerText)}</p>
    <p style="margin:0 0 16px 0;">${escapeHtml(bodyText)}</p>
    <p style="margin:0 0 0 0;color:#666;font-size:14px;">${escapeHtml(getBookingCancelFooter(lang, business))}</p>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
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
 * BOO-58A: review request after appointment (multilingual).
 */
export async function sendReviewRequestEmail(booking, business, service, customer, { link }) {
  if (!resend || !customer?.email || !link) return;
  const lang = getBookingLanguageRaw(booking) || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const parts = buildReviewRequestEmail(lang, { serviceName, businessName, link });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) {
      console.warn("[emailService] Review request email failed:", error.message);
      return;
    }
    return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Review request email error:", err.message);
  }
}

/** BOO-59A */
export async function sendWaitlistJoinEmail({ customer, business, serviceName, bookingLink, language }) {
  if (!resend || !customer?.email || !bookingLink) return;
  const lang = language || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const businessName = business?.name || business?.id || "Business";
  const parts = buildWaitlistJoinEmail(lang, { serviceName, businessName, bookingLink });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) console.warn("[emailService] Waitlist join email failed:", error.message);
    else return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Waitlist join email error:", err.message);
  }
}

/** BOO-59A */
export async function sendWaitlistSlotOpenEmail({
  customer,
  business,
  serviceName,
  date,
  time,
  link,
  language
}) {
  if (!resend || !customer?.email || !link) return;
  const lang = language || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const businessName = business?.name || business?.id || "Business";
  const parts = buildWaitlistSlotOpenEmail(lang, { serviceName, businessName, date, time, link });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) console.warn("[emailService] Waitlist slot email failed:", error.message);
    else return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Waitlist slot email error:", err.message);
  }
}

/** BOO-59A */
export async function sendWaitlistExpiredEmail({ customer, business, serviceName, bookingLink, language }) {
  if (!resend || !customer?.email || !bookingLink) return;
  const lang = language || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const businessName = business?.name || business?.id || "Business";
  const parts = buildWaitlistExpiredEmail(lang, { serviceName, businessName, bookingLink });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) console.warn("[emailService] Waitlist expired email failed:", error.message);
    else return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Waitlist expired email error:", err.message);
  }
}

/** BOO-60A */
export async function sendRecurringInitialBookingEmail(booking, business, service, customer) {
  if (!resend || !customer?.email) return;
  const lang = getBookingLanguageRaw(booking) || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const tz = booking?.slot?.timezone || business?.timezone || "America/Toronto";
  const { dateStr, timeStr } = formatSlotDateTime(booking.slot?.start, tz, lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const r = booking.recurring;
  const parts = buildRecurringInitialEmail(lang, {
    serviceName,
    businessName,
    dateStr,
    timeStr,
    occurrence: r?.occurrenceNumber ?? 1,
    total: r?.totalOccurrences ?? 1
  });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) console.warn("[emailService] Recurring initial email failed:", error.message);
    else return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Recurring initial email error:", err.message);
  }
}

/** BOO-60A */
export async function sendRecurringNextBookingEmail(booking, business, service, customer) {
  if (!resend || !customer?.email) return;
  const lang = getBookingLanguageRaw(booking) || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const tz = booking?.slot?.timezone || business?.timezone || "America/Toronto";
  const { dateStr, timeStr } = formatSlotDateTime(booking.slot?.start, tz, lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const parts = buildRecurringNextEmail(lang, { serviceName, businessName, dateStr, timeStr });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) console.warn("[emailService] Recurring next email failed:", error.message);
    else return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Recurring next email error:", err.message);
  }
}

/** BOO-60A — slot could not be booked for next occurrence */
export async function sendRecurringUnavailableEmail(booking, business, service, customer, { dateLabel, bookingLink }) {
  if (!resend || !customer?.email || !bookingLink) return;
  const lang = getBookingLanguageRaw(booking) || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const parts = buildRecurringUnavailableEmail(lang, {
    serviceName,
    businessName,
    dateStr: dateLabel,
    bookingLink
  });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) console.warn("[emailService] Recurring unavailable email failed:", error.message);
    else return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Recurring unavailable email error:", err.message);
  }
}

/**
 * Send booking cancellation email. Fire-and-forget; no-op if Resend not configured or no email.
 * @param {object} booking - booking doc (slot, serviceId, businessId, customer)
 * @param {object} business - business doc (name, timezone, weeklySchedule, assignedTwilioNumber)
 * @param {object} service - service doc (name)
 * @param {object} customer - customer (name, email)
 */
/**
 * BOO-45A: email after a no-show fee PaymentIntent succeeds.
 */
export async function sendNoShowChargeEmail(booking, business, service, customer, { amountMajor }) {
  if (!resend || !customer?.email) return;
  const lang = getBookingLanguageRaw(booking) || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const currency = resolveCurrency(business);
  const amountFormatted = formatMoneyForLocale(amountMajor, currency, lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const parts = buildNoShowChargeEmail(lang, {
    serviceName,
    businessName,
    amountFormatted,
    cardLast4: booking?.cardLast4,
    contactPhone: business?.businessProfile?.phone || business?.assignedTwilioNumber || ""
  });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    <p style="margin:0 0 16px 0;color:#b45309;font-weight:600;">${escapeHtml(lang === "fr" ? "Frais facturés" : lang === "es" ? "Cargo aplicado" : lang === "ar" ? "تم الخصم" : "Fee charged")}</p>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) console.warn("[emailService] No-show charge email failed:", error.message);
    return { id: data?.id };
  } catch (err) {
    console.error("[emailService] No-show charge email error:", err.message);
  }
}

/**
 * BOO-45A: cancellation within policy window with fee charged.
 */
export async function sendCancellationWithFeeEmail(booking, business, service, customer, { amountMajor }) {
  if (!resend || !customer?.email) return;
  const lang = getBookingLanguageRaw(booking) || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const currency = resolveCurrency(business);
  const amountFormatted = formatMoneyForLocale(amountMajor, currency, lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const parts = buildCancellationWithFeeEmail(lang, {
    serviceName,
    businessName,
    amountFormatted,
    cardLast4: booking?.cardLast4
  });
  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${escapeHtml(businessName)}</h1>
    ${parts.bodyHtml}
  `;
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
    });
    if (error) console.warn("[emailService] Cancellation+fee email failed:", error.message);
    return { id: data?.id };
  } catch (err) {
    console.error("[emailService] Cancellation+fee email error:", err.message);
  }
}

export async function sendCancellation(booking, business, service, customer) {
  if (!resend || !customer?.email) return;
  const lang = getBookingLanguageRaw(booking) || "en";
  const rtl = normalizeLangCode(lang) === "ar";
  const headings = getEmailHeadings(lang);
  const tz = resolveEmailTimezone(booking, business);
  const { dateStr, timeStr } = formatDateAndTime(booking.slot?.start, tz, lang);
  const serviceName = service?.name || booking?.serviceId || "Appointment";
  const businessName = business?.name || booking?.businessId || "Business";
  const serviceNameEsc = escapeHtml(serviceName);
  const businessNameEsc = escapeHtml(businessName);
  const parts = buildCancellationEmail(
    lang,
    serviceName,
    businessName,
    serviceNameEsc,
    businessNameEsc,
    dateStr,
    timeStr,
    business?.assignedTwilioNumber || null
  );

  const content = `
    <h1 style="margin:0 0 8px 0;font-size:24px;">${businessNameEsc}</h1>
    <p style="margin:0 0 16px 0;color:#b91c1c;font-weight:600;">${escapeHtml(parts.title)}</p>
    ${parts.bodyHtml}
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: customer.email,
      subject: parts.subject,
      html: baseHtml(content, { rtl, poweredBy: headings.poweredBy, htmlLang: emailHtmlLang(lang) })
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


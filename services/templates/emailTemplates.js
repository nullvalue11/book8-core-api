/**
 * Multilingual email subjects and labels for booking confirmations.
 */

import { normalizeLangCode } from "../localeFormat.js";

export const EMAIL_SUBJECTS = {
  en: (businessName) => `Booking Confirmed — ${businessName}`,
  fr: (businessName) => `Rendez-vous confirmé — ${businessName}`,
  es: (businessName) => `Cita confirmada — ${businessName}`,
  ar: (businessName) => `تم تأكيد الحجز — ${businessName}`
};

export const EMAIL_HEADINGS = {
  en: {
    confirmed: "Confirmed",
    addCalendar: "Add to your calendar",
    seeYou: "See you then",
    poweredBy: "Powered by Book8 AI"
  },
  fr: {
    confirmed: "Confirmé",
    addCalendar: "Ajoutez à votre calendrier",
    seeYou: "À bientôt",
    poweredBy: "Propulsé par Book8 AI"
  },
  es: {
    confirmed: "Confirmada",
    addCalendar: "Agregue a su calendario",
    seeYou: "Nos vemos",
    poweredBy: "Con tecnología de Book8 AI"
  },
  ar: {
    confirmed: "تم التأكيد",
    addCalendar: "أضف إلى تقويمك",
    seeYou: "نراك قريباً",
    poweredBy: "مدعوم من Book8 AI"
  }
};

/** Footer when business has a Twilio number (CANCEL BOOKING stays English). */
const CANCEL_WITH_PHONE = {
  en: (phone) =>
    `Need to cancel? Text CANCEL BOOKING to ${phone}, or call us to reschedule.`,
  fr: (phone) =>
    `Besoin d'annuler? Envoyez CANCEL BOOKING au ${phone}, ou appelez-nous pour reporter.`,
  es: (phone) =>
    `¿Necesita cancelar? Envíe CANCEL BOOKING al ${phone}, o llámenos para reprogramar.`,
  ar: (phone) =>
    `هل تحتاج للإلغاء؟ أرسل CANCEL BOOKING إلى ${phone}، أو اتصل بنا لإعادة الجدولة.`
};

const CANCEL_NO_PHONE = {
  en: () => `Need to cancel? Visit your confirmation email link to cancel or reschedule.`,
  fr: () =>
    `Besoin d'annuler? Utilisez le lien dans votre courriel de confirmation pour annuler ou reporter.`,
  es: () =>
    `¿Necesita cancelar? Use el enlace en su correo de confirmación para cancelar o reprogramar.`,
  ar: () => `هل تحتاج للإلغاء؟ استخدم الرابط في بريد التأكيد للإلغاء أو إعادة الجدولة.`
};

export function getEmailSubject(language, businessName) {
  const lang = normalizeLangCode(language);
  const subjectFn = EMAIL_SUBJECTS[lang] || EMAIL_SUBJECTS.en;
  return subjectFn(businessName);
}

export function getEmailHeadings(language) {
  const lang = normalizeLangCode(language);
  return EMAIL_HEADINGS[lang] || EMAIL_HEADINGS.en;
}

export function getBookingCancelFooter(language, business) {
  const lang = normalizeLangCode(language);
  const phone = business?.assignedTwilioNumber;
  if (phone) {
    const fn = CANCEL_WITH_PHONE[lang] || CANCEL_WITH_PHONE.en;
    return fn(phone);
  }
  const fn = CANCEL_NO_PHONE[lang] || CANCEL_NO_PHONE.en;
  return fn();
}

/** Cancellation email (after SMS cancel). Escaped HTML for service/business names. */
export const EMAIL_CANCEL = {
  en: {
    subject: (serviceName, businessName) => `Booking Cancelled — ${serviceName} at ${businessName}`,
    title: "Booking cancelled",
    bodyHtml: (serviceNameEsc, businessNameEsc, dateStr, timeStr, rebookLineEsc) =>
      `<p style="margin:0 0 8px 0;">Your <strong>${serviceNameEsc}</strong> appointment at ${businessNameEsc} on ${dateStr} at ${timeStr} has been cancelled.</p>` +
      `<p style="margin:0 0 0 0;color:#666;font-size:14px;">${rebookLineEsc}</p>`
  },
  fr: {
    subject: (serviceName, businessName) => `Rendez-vous annulé — ${serviceName} chez ${businessName}`,
    title: "Rendez-vous annulé",
    bodyHtml: (serviceNameEsc, businessNameEsc, dateStr, timeStr, rebookLineEsc) =>
      `<p style="margin:0 0 8px 0;">Votre rendez-vous <strong>${serviceNameEsc}</strong> chez ${businessNameEsc} le ${dateStr} à ${timeStr} a été annulé.</p>` +
      `<p style="margin:0 0 0 0;color:#666;font-size:14px;">${rebookLineEsc}</p>`
  },
  es: {
    subject: (serviceName, businessName) => `Cita cancelada — ${serviceName} en ${businessName}`,
    title: "Cita cancelada",
    bodyHtml: (serviceNameEsc, businessNameEsc, dateStr, timeStr, rebookLineEsc) =>
      `<p style="margin:0 0 8px 0;">Su cita <strong>${serviceNameEsc}</strong> en ${businessNameEsc} el ${dateStr} a las ${timeStr} ha sido cancelada.</p>` +
      `<p style="margin:0 0 0 0;color:#666;font-size:14px;">${rebookLineEsc}</p>`
  },
  ar: {
    subject: (serviceName, businessName) => `تم إلغاء الحجز — ${serviceName} في ${businessName}`,
    title: "تم إلغاء الحجز",
    bodyHtml: (serviceNameEsc, businessNameEsc, dateStr, timeStr, rebookLineEsc) =>
      `<p style="margin:0 0 8px 0;">تم إلغاء موعد <strong>${serviceNameEsc}</strong> في ${businessNameEsc} يوم ${dateStr} الساعة ${timeStr}.</p>` +
      `<p style="margin:0 0 0 0;color:#666;font-size:14px;">${rebookLineEsc}</p>`
  }
};

function rebookLineForCancel(language, phoneE164) {
  const lang = normalizeLangCode(language);
  if (phoneE164) {
    if (lang === "fr") return `Pour reprendre un rendez-vous, appelez le ${phoneE164}.`;
    if (lang === "es") return `Para reservar de nuevo, llame al ${phoneE164}.`;
    if (lang === "ar") return `لإعادة الحجز، اتصل على ${phoneE164}.`;
    return `To rebook or reschedule, call ${phoneE164}.`;
  }
  if (lang === "fr") return "Pour reprendre un rendez-vous, appelez-nous.";
  if (lang === "es") return "Para reservar de nuevo, llámenos.";
  if (lang === "ar") return "لإعادة الحجز، اتصل بنا.";
  return "To rebook or reschedule, call us.";
}

function escapeHtmlFragment(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildCancellationEmail(
  language,
  serviceNamePlain,
  businessNamePlain,
  serviceNameEsc,
  businessNameEsc,
  dateStr,
  timeStr,
  phoneE164
) {
  const lang = normalizeLangCode(language);
  const pack = EMAIL_CANCEL[lang] || EMAIL_CANCEL.en;
  const rebookEsc = escapeHtmlFragment(rebookLineForCancel(lang, phoneE164));
  return {
    subject: pack.subject(serviceNamePlain, businessNamePlain),
    title: pack.title,
    bodyHtml: pack.bodyHtml(serviceNameEsc, businessNameEsc, dateStr, timeStr, rebookEsc)
  };
}

/**
 * Multilingual email subjects and labels for booking confirmations.
 */

import { normalizeLangCode } from "../localeFormat.js";

export const EMAIL_SUBJECTS = {
  en: (serviceName, businessName) => `Booking Confirmed — ${serviceName} at ${businessName}`,
  fr: (serviceName, businessName) => `Rendez-vous confirmé — ${serviceName} chez ${businessName}`,
  es: (serviceName, businessName) => `Reserva confirmada — ${serviceName} en ${businessName}`,
  ar: (serviceName, businessName) => `تم تأكيد الحجز — ${serviceName} في ${businessName}`
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

export function getEmailSubject(language, serviceName, businessName) {
  const lang = normalizeLangCode(language);
  const subjectFn = EMAIL_SUBJECTS[lang] || EMAIL_SUBJECTS.en;
  return subjectFn(serviceName, businessName);
}

/**
 * Read `language` from a Mongoose document or plain object (BOO-38A: email must follow booking language).
 */
export function getBookingLanguageRaw(booking) {
  if (!booking || typeof booking !== "object") return undefined;
  const o = typeof booking.toObject === "function" ? booking.toObject({ flattenMaps: true }) : booking;
  const raw = o?.language;
  if (raw == null || raw === "") return undefined;
  return String(raw).trim();
}

/** Date + time line in confirmation body (localized connector, not English-only "at"). */
export function getConfirmationSlotDisplay(language, dateStr, timeStr) {
  const code = normalizeLangCode(language);
  if (code === "fr") return `${dateStr} à ${timeStr}`;
  if (code === "es") return `${dateStr} a las ${timeStr}`;
  if (code === "ar") return `${dateStr} الساعة ${timeStr}`;
  return `${dateStr} at ${timeStr}`;
}

/** Calendar button labels for confirmation email. */
export function getCalendarLinkLabels(language) {
  const code = normalizeLangCode(language);
  const packs = {
    en: { google: "Google Calendar", outlook: "Outlook", apple: "Apple / Download .ics" },
    fr: { google: "Google Agenda", outlook: "Outlook", apple: "Apple / Télécharger .ics" },
    es: { google: "Google Calendar", outlook: "Outlook", apple: "Apple / Descargar .ics" },
    ar: { google: "تقويم Google", outlook: "Outlook", apple: "Apple / تنزيل .ics" }
  };
  return packs[code] || packs.en;
}

/**
 * Reminder email subject + body (24h / 1h / 30min) in booking language.
 */
export function getReminderEmailParts(language, type, { serviceName, businessName, timeStr }) {
  const code = normalizeLangCode(language);
  const s = serviceName;
  const b = businessName;
  const t = timeStr;
  if (type === "30min") {
    const packs = {
      en: {
        subject: `Starting soon: ${s} at ${b} in 30 minutes`,
        headerText: "Starting in 30 minutes",
        bodyText: `Your ${s} appointment at ${b} starts in 30 minutes! See you at ${t}!`
      },
      fr: {
        subject: `Bientôt : ${s} chez ${b} dans 30 minutes`,
        headerText: "Dans 30 minutes",
        bodyText: `Votre rendez-vous ${s} chez ${b} commence dans 30 minutes ! Rendez-vous à ${t} !`
      },
      es: {
        subject: `Pronto: ${s} en ${b} en 30 minutos`,
        headerText: "En 30 minutos",
        bodyText: `Su cita de ${s} en ${b} comienza en 30 minutos. ¡Nos vemos a las ${t}!`
      },
      ar: {
        subject: `قريباً: ${s} في ${b} خلال 30 دقيقة`,
        headerText: "خلال 30 دقيقة",
        bodyText: `موعدك ${s} في ${b} يبدأ خلال 30 دقيقة! نراك الساعة ${t}!`
      }
    };
    return packs[code] || packs.en;
  }
  if (type === "1h") {
    const packs = {
      en: {
        subject: `Starting soon: ${s} at ${b} in 1 hour`,
        headerText: "Starting in 1 hour",
        bodyText: `Your ${s} appointment at ${b} starts in 1 hour at ${t}. See you soon!`
      },
      fr: {
        subject: `Bientôt : ${s} chez ${b} dans 1 heure`,
        headerText: "Dans 1 heure",
        bodyText: `Votre rendez-vous ${s} chez ${b} commence dans 1 heure à ${t}. À bientôt !`
      },
      es: {
        subject: `Pronto: ${s} en ${b} en 1 hora`,
        headerText: "En 1 hora",
        bodyText: `Su cita de ${s} en ${b} comienza en 1 hora a las ${t}. ¡Hasta pronto!`
      },
      ar: {
        subject: `قريباً: ${s} في ${b} خلال ساعة`,
        headerText: "خلال ساعة",
        bodyText: `موعدك ${s} في ${b} يبدأ خلال ساعة عند ${t}. نراك قريباً!`
      }
    };
    return packs[code] || packs.en;
  }
  const packs24 = {
    en: {
      subject: `Reminder: ${s} at ${b} tomorrow`,
      headerText: "Appointment tomorrow",
      bodyText: `Just a reminder — your ${s} appointment at ${b} is tomorrow at ${t}. See you then!`
    },
    fr: {
      subject: `Rappel : ${s} chez ${b} demain`,
      headerText: "Rendez-vous demain",
      bodyText: `Petit rappel — votre rendez-vous ${s} chez ${b} est demain à ${t}. À bientôt !`
    },
    es: {
      subject: `Recordatorio: ${s} en ${b} mañana`,
      headerText: "Cita mañana",
      bodyText: `Recordatorio: su cita de ${s} en ${b} es mañana a las ${t}. ¡Nos vemos!`
    },
    ar: {
      subject: `تذكير: ${s} في ${b} غداً`,
      headerText: "موعد غداً",
      bodyText: `تذكير — موعدك ${s} في ${b} غداً الساعة ${t}. نراك!`
    }
  };
  return packs24[code] || packs24.en;
}

/** ICS / calendar event description in the booking language. */
export function buildIcsEventDescription(
  language,
  { serviceName, businessName, dateStr, timeStr, bookingId }
) {
  const code = normalizeLangCode(language);
  const slotLine = getConfirmationSlotDisplay(language, dateStr, timeStr);
  const id = bookingId ? String(bookingId) : "";
  const packs = {
    en: () =>
      [
        `${serviceName} at ${businessName}`,
        slotLine,
        id ? `Booking ref: ${id}` : null,
        "Booked via Book8 AI"
      ]
        .filter(Boolean)
        .join("\n"),
    fr: () =>
      [
        `${serviceName} chez ${businessName}`,
        slotLine,
        id ? `Réf. réservation : ${id}` : null,
        "Réservé via Book8 AI"
      ]
        .filter(Boolean)
        .join("\n"),
    es: () =>
      [
        `${serviceName} en ${businessName}`,
        slotLine,
        id ? `Ref. reserva: ${id}` : null,
        "Reservado con Book8 AI"
      ]
        .filter(Boolean)
        .join("\n"),
    ar: () =>
      [
        `${serviceName} في ${businessName}`,
        slotLine,
        id ? `مرجع الحجز: ${id}` : null,
        "محجوز عبر Book8 AI"
      ]
        .filter(Boolean)
        .join("\n")
  };
  const fn = packs[code] || packs.en;
  return fn();
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
    subject: (serviceName, businessName) => `Reserva cancelada — ${serviceName} en ${businessName}`,
    title: "Reserva cancelada",
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

/** BOO-45A: no-show fee charged (multilingual). */
export function buildNoShowChargeEmail(language, { serviceName, businessName, amountFormatted, cardLast4, contactPhone }) {
  const lang = normalizeLangCode(language);
  const card = cardLast4 ? `•••• ${String(cardLast4).slice(-4)}` : "••••";
  const phoneLine = contactPhone ? escapeHtmlFragment(contactPhone) : "";
  const packs = {
    en: {
      subject: `No-show fee charged — ${serviceName} at ${businessName}`,
      bodyHtml: `<p style="margin:0 0 12px 0;">A no-show fee of <strong>${escapeHtmlFragment(amountFormatted)}</strong> has been charged to ${card} for your missed appointment: <strong>${escapeHtmlFragment(serviceName)}</strong> at ${escapeHtmlFragment(businessName)}.</p>` +
        (phoneLine ? `<p style="margin:0;color:#666;font-size:14px;">Questions? Call ${phoneLine}.</p>` : "")
    },
    fr: {
      subject: `Frais d'absence facturés — ${serviceName} chez ${businessName}`,
      bodyHtml: `<p style="margin:0 0 12px 0;">Des frais d'absence de <strong>${escapeHtmlFragment(amountFormatted)}</strong> ont été débités sur ${card} pour le rendez-vous manqué : <strong>${escapeHtmlFragment(serviceName)}</strong> chez ${escapeHtmlFragment(businessName)}.</p>` +
        (phoneLine ? `<p style="margin:0;color:#666;font-size:14px;">Questions ? Appelez le ${phoneLine}.</p>` : "")
    },
    es: {
      subject: `Cargo por inasistencia — ${serviceName} en ${businessName}`,
      bodyHtml: `<p style="margin:0 0 12px 0;">Se ha cargado una tarifa por inasistencia de <strong>${escapeHtmlFragment(amountFormatted)}</strong> a ${card} por la cita perdida: <strong>${escapeHtmlFragment(serviceName)}</strong> en ${escapeHtmlFragment(businessName)}.</p>` +
        (phoneLine ? `<p style="margin:0;color:#666;font-size:14px;">¿Preguntas? Llame al ${phoneLine}.</p>` : "")
    },
    ar: {
      subject: `تم خصم رسوم عدم الحضور — ${serviceName} في ${businessName}`,
      bodyHtml: `<p style="margin:0 0 12px 0;">تم خصم رسوم عدم حضور بقيمة <strong>${escapeHtmlFragment(amountFormatted)}</strong> من ${card} للموعد الفائت: <strong>${escapeHtmlFragment(serviceName)}</strong> في ${escapeHtmlFragment(businessName)}.</p>` +
        (phoneLine ? `<p style="margin:0;color:#666;font-size:14px;">للاستفسار اتصل على ${phoneLine}.</p>` : "")
    }
  };
  const p = packs[lang] || packs.en;
  return { subject: p.subject, bodyHtml: p.bodyHtml };
}

/** BOO-45A: booking cancelled and cancellation fee charged. */
export function buildCancellationWithFeeEmail(
  language,
  { serviceName, businessName, amountFormatted, cardLast4 }
) {
  const lang = normalizeLangCode(language);
  const card = cardLast4 ? `•••• ${String(cardLast4).slice(-4)}` : "••••";
  const packs = {
    en: {
      subject: `Booking cancelled — a cancellation fee of ${amountFormatted} has been charged`,
      bodyHtml: `<p style="margin:0 0 12px 0;">Your booking for <strong>${escapeHtmlFragment(serviceName)}</strong> at ${escapeHtmlFragment(businessName)} has been cancelled. A cancellation fee of <strong>${escapeHtmlFragment(amountFormatted)}</strong> was charged to ${card} because you cancelled within the policy window.</p>`
    },
    fr: {
      subject: `Rendez-vous annulé — des frais d'annulation de ${amountFormatted} ont été prélevés`,
      bodyHtml: `<p style="margin:0 0 12px 0;">Votre rendez-vous pour <strong>${escapeHtmlFragment(serviceName)}</strong> chez ${escapeHtmlFragment(businessName)} a été annulé. Des frais de <strong>${escapeHtmlFragment(amountFormatted)}</strong> ont été débités sur ${card} (fenêtre d'annulation).</p>`
    },
    es: {
      subject: `Reserva cancelada — se ha cobrado una tarifa de cancelación de ${amountFormatted}`,
      bodyHtml: `<p style="margin:0 0 12px 0;">Su reserva de <strong>${escapeHtmlFragment(serviceName)}</strong> en ${escapeHtmlFragment(businessName)} ha sido cancelada. Se cobró una tarifa de <strong>${escapeHtmlFragment(amountFormatted)}</strong> a ${card} por cancelar dentro del plazo.</p>`
    },
    ar: {
      subject: `تم إلغاء الحجز — تم خصم رسوم إلغاء قدرها ${amountFormatted}`,
      bodyHtml: `<p style="margin:0 0 12px 0;">تم إلغاء حجزك لـ <strong>${escapeHtmlFragment(serviceName)}</strong> في ${escapeHtmlFragment(businessName)}. تم خصم <strong>${escapeHtmlFragment(amountFormatted)}</strong> من ${card} بسبب الإلغاء ضمن نافذة السياسة.</p>`
    }
  };
  const p = packs[lang] || packs.en;
  return { subject: p.subject, bodyHtml: p.bodyHtml };
}

/** BOO-58A: post-appointment review request */
export function buildReviewRequestEmail(language, { serviceName, businessName, link }) {
  const lang = normalizeLangCode(language);
  const linkEsc = escapeHtmlFragment(link);
  const svc = escapeHtmlFragment(serviceName);
  const biz = escapeHtmlFragment(businessName);
  const packs = {
    en: {
      subject: `How was your visit at ${businessName}?`,
      bodyHtml: `<p style="margin:0 0 16px 0;">How was your <strong>${svc}</strong> at <strong>${biz}</strong>? We'd love your feedback.</p>
<p style="margin:0 0 24px 0;text-align:center;"><a href="${linkEsc}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;border-radius:8px;color:#fff;text-decoration:none;font-size:16px;">Leave a quick review</a></p>
<p style="margin:0;font-size:13px;color:#666;">Or copy this link:<br/><span style="word-break:break-all;">${linkEsc}</span></p>`
    },
    fr: {
      subject: `Comment s'est passée votre visite chez ${businessName} ?`,
      bodyHtml: `<p style="margin:0 0 16px 0;">Comment s'est passé votre rendez-vous <strong>${svc}</strong> chez <strong>${biz}</strong> ? Votre avis nous intéresse.</p>
<p style="margin:0 0 24px 0;text-align:center;"><a href="${linkEsc}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;border-radius:8px;color:#fff;text-decoration:none;font-size:16px;">Laisser un avis</a></p>
<p style="margin:0;font-size:13px;color:#666;">Ou copiez ce lien :<br/><span style="word-break:break-all;">${linkEsc}</span></p>`
    },
    es: {
      subject: `¿Cómo fue su visita en ${businessName}?`,
      bodyHtml: `<p style="margin:0 0 16px 0;">¿Cómo fue su <strong>${svc}</strong> en <strong>${biz}</strong>? Nos encantaría conocer su opinión.</p>
<p style="margin:0 0 24px 0;text-align:center;"><a href="${linkEsc}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;border-radius:8px;color:#fff;text-decoration:none;font-size:16px;">Dejar una reseña</a></p>
<p style="margin:0;font-size:13px;color:#666;">O copie este enlace:<br/><span style="word-break:break-all;">${linkEsc}</span></p>`
    },
    ar: {
      subject: `كيف كانت زيارتك إلى ${businessName}؟`,
      bodyHtml: `<p style="margin:0 0 16px 0;">كيف كانت تجربتك مع <strong>${svc}</strong> في <strong>${biz}</strong>؟ نقدّر رأيك.</p>
<p style="margin:0 0 24px 0;text-align:center;"><a href="${linkEsc}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;border-radius:8px;color:#fff;text-decoration:none;font-size:16px;">اترك تقييماً سريعاً</a></p>
<p style="margin:0;font-size:13px;color:#666;">أو انسخ الرابط:<br/><span style="word-break:break-all;">${linkEsc}</span></p>`
    }
  };
  const p = packs[lang] || packs.en;
  return { subject: p.subject, bodyHtml: p.bodyHtml };
}

/** BOO-59A: waitlist join confirmation */
export function buildWaitlistJoinEmail(language, { serviceName, businessName, bookingLink }) {
  const lang = normalizeLangCode(language);
  const svc = escapeHtmlFragment(serviceName);
  const biz = escapeHtmlFragment(businessName);
  const linkEsc = escapeHtmlFragment(bookingLink);
  const packs = {
    en: {
      subject: `You're on the waitlist — ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">You're on the waitlist at <strong>${biz}</strong> for <strong>${svc}</strong>. We'll notify you when a slot opens up!</p>
<p style="margin:0;"><a href="${linkEsc}" style="color:#2563eb;">${linkEsc}</a></p>`
    },
    fr: {
      subject: `Liste d'attente — ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">Vous êtes sur la liste d'attente chez <strong>${biz}</strong> pour <strong>${svc}</strong>. Nous vous préviendrons dès qu'un créneau se libère !</p>
<p style="margin:0;"><a href="${linkEsc}" style="color:#2563eb;">${linkEsc}</a></p>`
    },
    es: {
      subject: `Lista de espera — ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">Está en la lista de espera en <strong>${biz}</strong> para <strong>${svc}</strong>. ¡Le avisaremos cuando haya un hueco!</p>
<p style="margin:0;"><a href="${linkEsc}" style="color:#2563eb;">${linkEsc}</a></p>`
    },
    ar: {
      subject: `قائمة الانتظار — ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">أنت على قائمة الانتظار في <strong>${biz}</strong> لـ <strong>${svc}</strong>. سنُعلمك عند توفر موعد!</p>
<p style="margin:0;"><a href="${linkEsc}" style="color:#2563eb;">${linkEsc}</a></p>`
    }
  };
  const p = packs[lang] || packs.en;
  return { subject: p.subject, bodyHtml: p.bodyHtml };
}

/** BOO-59A: slot freed — book now */
export function buildWaitlistSlotOpenEmail(language, { serviceName, businessName, date, time, link }) {
  const lang = normalizeLangCode(language);
  const svc = escapeHtmlFragment(serviceName);
  const biz = escapeHtmlFragment(businessName);
  const d = escapeHtmlFragment(date);
  const t = escapeHtmlFragment(time);
  const linkEsc = escapeHtmlFragment(link);
  const packs = {
    en: {
      subject: `A slot opened at ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">Great news! A slot opened at <strong>${biz}</strong> for <strong>${svc}</strong> on <strong>${d}</strong> at <strong>${t}</strong>.</p>
<p style="margin:0 0 24px 0;text-align:center;"><a href="${linkEsc}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;border-radius:8px;color:#fff;text-decoration:none;font-size:16px;">Book now</a></p>
<p style="margin:0;font-size:13px;color:#666;">This offer expires in 4 hours.</p>`
    },
    fr: {
      subject: `Créneau disponible chez ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">Bonne nouvelle ! Un créneau s'est libéré chez <strong>${biz}</strong> pour <strong>${svc}</strong> le <strong>${d}</strong> à <strong>${t}</strong>.</p>
<p style="margin:0 0 24px 0;text-align:center;"><a href="${linkEsc}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;border-radius:8px;color:#fff;text-decoration:none;font-size:16px;">Réserver</a></p>
<p style="margin:0;font-size:13px;color:#666;">Offre valable 4 heures.</p>`
    },
    es: {
      subject: `Hueco disponible en ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">¡Buenas noticias! Hay un hueco en <strong>${biz}</strong> para <strong>${svc}</strong> el <strong>${d}</strong> a las <strong>${t}</strong>.</p>
<p style="margin:0 0 24px 0;text-align:center;"><a href="${linkEsc}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;border-radius:8px;color:#fff;text-decoration:none;font-size:16px;">Reservar</a></p>
<p style="margin:0;font-size:13px;color:#666;">Oferta válida 4 horas.</p>`
    },
    ar: {
      subject: `موعد متاح في ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">أخبار سارّة! توفّر موعد في <strong>${biz}</strong> لـ <strong>${svc}</strong> يوم <strong>${d}</strong> الساعة <strong>${t}</strong>.</p>
<p style="margin:0 0 24px 0;text-align:center;"><a href="${linkEsc}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;border-radius:8px;color:#fff;text-decoration:none;font-size:16px;">احجز الآن</a></p>
<p style="margin:0;font-size:13px;color:#666;">ينتهي العرض خلال 4 ساعات.</p>`
    }
  };
  const p = packs[lang] || packs.en;
  return { subject: p.subject, bodyHtml: p.bodyHtml };
}

/** BOO-59A: waitlist row expired (14d) */
export function buildWaitlistExpiredEmail(language, { serviceName, businessName, bookingLink }) {
  const lang = normalizeLangCode(language);
  const svc = escapeHtmlFragment(serviceName);
  const biz = escapeHtmlFragment(businessName);
  const linkEsc = escapeHtmlFragment(bookingLink);
  const packs = {
    en: {
      subject: `Waitlist request expired — ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">Your waitlist request at <strong>${biz}</strong> for <strong>${svc}</strong> has expired.</p>
<p style="margin:0;"><a href="${linkEsc}" style="color:#2563eb;">Check availability</a></p>`
    },
    fr: {
      subject: `Liste d'attente expirée — ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">Votre demande de liste d'attente chez <strong>${biz}</strong> pour <strong>${svc}</strong> a expiré.</p>
<p style="margin:0;"><a href="${linkEsc}" style="color:#2563eb;">Voir les disponibilités</a></p>`
    },
    es: {
      subject: `Lista de espera caducada — ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">Su solicitud de lista de espera en <strong>${biz}</strong> para <strong>${svc}</strong> ha caducado.</p>
<p style="margin:0;"><a href="${linkEsc}" style="color:#2563eb;">Ver disponibilidad</a></p>`
    },
    ar: {
      subject: `انتهت قائمة الانتظار — ${businessName}`,
      bodyHtml: `<p style="margin:0 0 16px 0;">انتهت صلاحية طلب قائمة الانتظار لدى <strong>${biz}</strong> لـ <strong>${svc}</strong>.</p>
<p style="margin:0;"><a href="${linkEsc}" style="color:#2563eb;">التحقق من المواعيد</a></p>`
    }
  };
  const p = packs[lang] || packs.en;
  return { subject: p.subject, bodyHtml: p.bodyHtml };
}

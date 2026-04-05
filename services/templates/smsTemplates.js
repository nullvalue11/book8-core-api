/**
 * Multilingual SMS templates for booking confirmations and cancellations.
 * "CANCEL BOOKING" stays English in all languages (carrier / Twilio keyword requirement).
 */

import { normalizeLangCode } from "../localeFormat.js";

const SMS_TEMPLATES = {
  en: {
    confirmation: (data) =>
      `Your appointment at ${data.businessName} is confirmed for ${data.date} at ${data.time}. To cancel, reply CANCEL BOOKING.`,

    cancellation: (data) =>
      `Your ${data.serviceName} appointment on ${data.date} at ${data.time} has been cancelled.\n` +
      `If you need to rebook, call us!`,

    cancelFeeWarning: (data) => data.message,

    /** BOO-58A */
    reviewRequest: (data) =>
      `How was your ${data.serviceName} at ${data.businessName}? We'd love your feedback: ${data.link}`,

    /** BOO-59A */
    waitlistJoin: (data) =>
      `You're on the waitlist at ${data.businessName} for ${data.serviceName}. We'll notify you when a slot opens up!`,
    waitlistSlotOpen: (data) =>
      `A slot just opened at ${data.businessName}! ${data.serviceName} on ${data.date} at ${data.time}. Book now: ${data.link} — this offer expires in 4 hours.`,
    waitlistExpired: (data) =>
      `Your waitlist request at ${data.businessName} for ${data.serviceName} has expired. Visit ${data.bookingLink} to check availability.`
  },

  fr: {
    confirmation: (data) =>
      `Votre rendez-vous chez ${data.businessName} est confirmé pour le ${data.date} à ${data.time}. Pour annuler, répondez CANCEL BOOKING.`,

    cancellation: (data) =>
      `Votre rendez-vous ${data.serviceName} du ${data.date} à ${data.time} a été annulé.\n` +
      `Pour reprendre un rendez-vous, appelez-nous!`,

    cancelFeeWarning: (data) => data.message,

    reviewRequest: (data) =>
      `Comment s'est passé votre ${data.serviceName} chez ${data.businessName} ? Donnez-nous votre avis : ${data.link}`,

    waitlistJoin: (data) =>
      `Vous êtes sur la liste d'attente chez ${data.businessName} pour ${data.serviceName}. Nous vous préviendrons dès qu'un créneau se libère !`,
    waitlistSlotOpen: (data) =>
      `Un créneau vient de s'ouvrir chez ${data.businessName} ! ${data.serviceName} le ${data.date} à ${data.time}. Réservez : ${data.link} — offre valable 4 h.`,
    waitlistExpired: (data) =>
      `Votre demande de liste d'attente chez ${data.businessName} pour ${data.serviceName} a expiré. Consultez ${data.bookingLink} pour les disponibilités.`
  },

  es: {
    confirmation: (data) =>
      `Su cita en ${data.businessName} está confirmada para el ${data.date} a las ${data.time}. Para cancelar, responda CANCEL BOOKING.`,

    cancellation: (data) =>
      `Su cita de ${data.serviceName} del ${data.date} a las ${data.time} ha sido cancelada.\n` +
      `Si necesita reservar de nuevo, ¡llámenos!`,

    cancelFeeWarning: (data) => data.message,

    reviewRequest: (data) =>
      `¿Cómo fue su ${data.serviceName} en ${data.businessName}? Nos encantaría su opinión: ${data.link}`,

    waitlistJoin: (data) =>
      `Está en la lista de espera en ${data.businessName} para ${data.serviceName}. ¡Le avisaremos cuando haya un hueco!`,
    waitlistSlotOpen: (data) =>
      `¡Acaba de liberarse un hueco en ${data.businessName}! ${data.serviceName} el ${data.date} a las ${data.time}. Reserve: ${data.link} — oferta 4 horas.`,
    waitlistExpired: (data) =>
      `Su solicitud de lista de espera en ${data.businessName} para ${data.serviceName} ha caducado. Visite ${data.bookingLink} para ver disponibilidad.`
  },

  ar: {
    confirmation: (data) =>
      `تم تأكيد موعدك في ${data.businessName} بتاريخ ${data.date} الساعة ${data.time}. للإلغاء، أرسل CANCEL BOOKING.`,

    cancellation: (data) =>
      `تم إلغاء موعد ${data.serviceName} يوم ${data.date} الساعة ${data.time}.\n` +
      `لإعادة الحجز، اتصل بنا!`,

    /** BOO-45A: fee warning — body must include CONFIRM CANCEL instruction */
    cancelFeeWarning: (data) => data.message,

    reviewRequest: (data) =>
      `كيف كانت تجربتك مع ${data.serviceName} في ${data.businessName}؟ نقدر رأيك: ${data.link}`,

    waitlistJoin: (data) =>
      `أنت على قائمة الانتظار في ${data.businessName} لخدمة ${data.serviceName}. سنُعلمك عند توفر موعد!`,
    waitlistSlotOpen: (data) =>
      `توفّر موعد في ${data.businessName}! ${data.serviceName} يوم ${data.date} الساعة ${data.time}. احجز الآن: ${data.link} — العرض ينتهي خلال 4 ساعات.`,
    waitlistExpired: (data) =>
      `انتهت صلاحية طلب قائمة الانتظار لدى ${data.businessName} لـ ${data.serviceName}. زُر ${data.bookingLink} للتحقق من المواعيد.`
  }
};

/**
 * @param {string} language - booking language (e.g. fr, fr-CA)
 * @param {'confirmation'|'cancellation'|'cancelFeeWarning'|'reviewRequest'|'waitlistJoin'|'waitlistSlotOpen'|'waitlistExpired'} type
 */
export function getSmsTemplate(language, type) {
  const lang = normalizeLangCode(language);
  const templates = SMS_TEMPLATES[lang] || SMS_TEMPLATES.en;
  const fn = templates[type] || SMS_TEMPLATES.en[type];
  return fn || SMS_TEMPLATES.en[type];
}

export { SMS_TEMPLATES };

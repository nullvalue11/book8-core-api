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
      `How was your ${data.serviceName} at ${data.businessName}? We'd love your feedback: ${data.link}`
  },

  fr: {
    confirmation: (data) =>
      `Votre rendez-vous chez ${data.businessName} est confirmé pour le ${data.date} à ${data.time}. Pour annuler, répondez CANCEL BOOKING.`,

    cancellation: (data) =>
      `Votre rendez-vous ${data.serviceName} du ${data.date} à ${data.time} a été annulé.\n` +
      `Pour reprendre un rendez-vous, appelez-nous!`,

    cancelFeeWarning: (data) => data.message,

    reviewRequest: (data) =>
      `Comment s'est passé votre ${data.serviceName} chez ${data.businessName} ? Donnez-nous votre avis : ${data.link}`
  },

  es: {
    confirmation: (data) =>
      `Su cita en ${data.businessName} está confirmada para el ${data.date} a las ${data.time}. Para cancelar, responda CANCEL BOOKING.`,

    cancellation: (data) =>
      `Su cita de ${data.serviceName} del ${data.date} a las ${data.time} ha sido cancelada.\n` +
      `Si necesita reservar de nuevo, ¡llámenos!`,

    cancelFeeWarning: (data) => data.message,

    reviewRequest: (data) =>
      `¿Cómo fue su ${data.serviceName} en ${data.businessName}? Nos encantaría su opinión: ${data.link}`
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
      `كيف كانت تجربتك مع ${data.serviceName} في ${data.businessName}؟ نقدر رأيك: ${data.link}`
  }
};

/**
 * @param {string} language - booking language (e.g. fr, fr-CA)
 * @param {'confirmation'|'cancellation'|'cancelFeeWarning'|'reviewRequest'} type
 */
export function getSmsTemplate(language, type) {
  const lang = normalizeLangCode(language);
  const templates = SMS_TEMPLATES[lang] || SMS_TEMPLATES.en;
  const fn = templates[type] || SMS_TEMPLATES.en[type];
  return fn || SMS_TEMPLATES.en[type];
}

export { SMS_TEMPLATES };

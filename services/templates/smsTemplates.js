/**
 * Multilingual SMS templates for booking confirmations and cancellations.
 * "CANCEL BOOKING" stays English in all languages (carrier / Twilio keyword requirement).
 */

import { normalizeLangCode } from "../localeFormat.js";

const SMS_TEMPLATES = {
  en: {
    confirmation: (data) =>
      `✅ Booked! ${data.serviceName} on ${data.date} at ${data.time} at ${data.businessName}.\n` +
      `Add to calendar: check your confirmation email for Google, Outlook, or Apple links.\n` +
      `See you then${data.customerName ? `, ${data.customerName}` : ""}!\n\n` +
      `Need to cancel? Reply CANCEL BOOKING to this number.`,

    cancellation: (data) =>
      `Your ${data.serviceName} appointment on ${data.date} at ${data.time} has been cancelled.\n` +
      `If you need to rebook, call us!`
  },

  fr: {
    confirmation: (data) =>
      `✅ Réservé! ${data.serviceName} le ${data.date} à ${data.time} chez ${data.businessName}.\n` +
      `Ajoutez à votre calendrier : consultez votre courriel de confirmation pour les liens Google, Outlook ou Apple.\n` +
      `À bientôt${data.customerName ? `, ${data.customerName}` : ""}!\n\n` +
      `Besoin d'annuler? Répondez CANCEL BOOKING à ce numéro.`,

    cancellation: (data) =>
      `Votre rendez-vous ${data.serviceName} du ${data.date} à ${data.time} a été annulé.\n` +
      `Pour reprendre un rendez-vous, appelez-nous!`
  },

  es: {
    confirmation: (data) =>
      `✅ ¡Reservado! ${data.serviceName} el ${data.date} a las ${data.time} en ${data.businessName}.\n` +
      `Agregue a su calendario: revise su correo de confirmación para los enlaces de Google, Outlook o Apple.\n` +
      `¡Nos vemos${data.customerName ? `, ${data.customerName}` : ""}!\n\n` +
      `¿Necesita cancelar? Responda CANCEL BOOKING a este número.`,

    cancellation: (data) =>
      `Su cita de ${data.serviceName} del ${data.date} a las ${data.time} ha sido cancelada.\n` +
      `Si necesita reservar de nuevo, ¡llámenos!`
  },

  ar: {
    confirmation: (data) =>
      `✅ تم الحجز! ${data.serviceName} يوم ${data.date} الساعة ${data.time} في ${data.businessName}.\n` +
      `أضف إلى تقويمك: تحقق من بريدك الإلكتروني للحصول على روابط Google أو Outlook أو Apple.\n` +
      `نراك قريباً${data.customerName ? `، ${data.customerName}` : ""}!\n\n` +
      `هل تحتاج للإلغاء؟ أرسل CANCEL BOOKING إلى هذا الرقم.`,

    cancellation: (data) =>
      `تم إلغاء موعد ${data.serviceName} يوم ${data.date} الساعة ${data.time}.\n` +
      `لإعادة الحجز، اتصل بنا!`
  }
};

/**
 * @param {string} language - booking language (e.g. fr, fr-CA)
 * @param {'confirmation'|'cancellation'} type
 */
export function getSmsTemplate(language, type) {
  const lang = normalizeLangCode(language);
  const templates = SMS_TEMPLATES[lang] || SMS_TEMPLATES.en;
  const fn = templates[type] || SMS_TEMPLATES.en[type];
  return fn || SMS_TEMPLATES.en[type];
}

export { SMS_TEMPLATES };

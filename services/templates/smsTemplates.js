/**
 * Multilingual SMS templates for booking confirmations and cancellations.
 *
 * BOO-SMS-COMPLIANCE-1A: TCPA / CTIA / Infobip 10DLC required disclosures.
 * - Confirmation (first/transactional message): business name, service name, date/time,
 *   CANCEL BOOKING (in-app cancel keyword), STOP (opt-out), HELP (support),
 *   "Msg&data rates may apply" (or locale-equivalent).
 * - Reminder / Cancellation / Reschedule: business name, service name, STOP (opt-out)
 *   at minimum. CANCEL BOOKING included where the appointment can still be cancelled.
 *
 * "STOP" / "HELP" / "CANCEL BOOKING" stay English in all locales because they are
 * keywords interpreted by the carrier / our messaging layer.
 */

import { normalizeLangCode } from "../localeFormat.js";

const SMS_TEMPLATES = {
  en: {
    confirmation: (data) =>
      `${data.businessName}: Your ${data.serviceName} is confirmed for ${data.date} at ${data.time}. ` +
      `Reply CANCEL BOOKING to cancel, STOP to unsubscribe, HELP for help. Msg&data rates may apply.`,

    reminder: (data) =>
      `${data.businessName}: Reminder — your ${data.serviceName} is tomorrow at ${data.time}. ` +
      `Reply CANCEL BOOKING to cancel, STOP to unsubscribe.`,
    reminderOneHour: (data) =>
      `${data.businessName}: Reminder — your ${data.serviceName} starts in 1 hour. ` +
      `Reply STOP to unsubscribe.`,
    reminderThirtyMin: (data) =>
      `${data.businessName}: Reminder — your ${data.serviceName} starts in 30 min. ` +
      `Reply STOP to unsubscribe.`,

    cancellation: (data) =>
      `${data.businessName}: Your ${data.serviceName} on ${data.date} at ${data.time} has been cancelled. ` +
      `Reply STOP to unsubscribe.`,

    cancelFeeWarning: (data) => data.message,

    /** BOO-58A */
    reviewRequest: (data) =>
      `How was your ${data.serviceName} at ${data.businessName}? We'd love your feedback: ${data.link}`,

    /** BOO-98A reschedule */
    reschedule: (data) =>
      `${data.businessName}: Your ${data.serviceName} has been moved to ${data.date} at ${data.time}. ` +
      `Reply CANCEL BOOKING to cancel, STOP to unsubscribe.`,

    /** BOO-59A */
    waitlistJoin: (data) =>
      `You're on the waitlist at ${data.businessName} for ${data.serviceName}. We'll notify you when a slot opens up!`,
    waitlistSlotOpen: (data) =>
      `A slot just opened at ${data.businessName}! ${data.serviceName} on ${data.date} at ${data.time}. Book now: ${data.link} — this offer expires in 4 hours.`,
    waitlistExpired: (data) =>
      `Your waitlist request at ${data.businessName} for ${data.serviceName} has expired. Visit ${data.bookingLink} to check availability.`,

    /** BOO-60A */
    recurringInitial: (data) =>
      `Your recurring ${data.serviceName} at ${data.businessName} is confirmed for ${data.date} at ${data.time}. This is appointment ${data.occurrence} of ${data.total}. To cancel this occurrence, reply CANCEL BOOKING.`,
    recurringNext: (data) =>
      `Your next recurring ${data.serviceName} at ${data.businessName} has been booked for ${data.date} at ${data.time}. To cancel, reply CANCEL BOOKING.`,
    recurringUnavailable: (data) =>
      `Your recurring ${data.serviceName} at ${data.businessName} on ${data.date} couldn't be booked — the slot is taken. Book a different time: ${data.link}`
  },

  fr: {
    confirmation: (data) =>
      `${data.businessName}: Votre ${data.serviceName} est confirmé pour ${data.date} à ${data.time}. ` +
      `Répondez CANCEL BOOKING pour annuler, STOP pour vous désinscrire, HELP pour aide. ` +
      `Frais de messagerie applicables.`,

    reminder: (data) =>
      `${data.businessName}: Rappel — votre ${data.serviceName} est demain à ${data.time}. ` +
      `Répondez CANCEL BOOKING pour annuler, STOP pour vous désinscrire.`,
    reminderOneHour: (data) =>
      `${data.businessName}: Rappel — votre ${data.serviceName} commence dans 1 heure. ` +
      `Répondez STOP pour vous désinscrire.`,
    reminderThirtyMin: (data) =>
      `${data.businessName}: Rappel — votre ${data.serviceName} commence dans 30 min. ` +
      `Répondez STOP pour vous désinscrire.`,

    cancellation: (data) =>
      `${data.businessName}: Votre ${data.serviceName} du ${data.date} à ${data.time} a été annulé. ` +
      `Répondez STOP pour vous désinscrire.`,

    cancelFeeWarning: (data) => data.message,

    reschedule: (data) =>
      `${data.businessName}: Votre ${data.serviceName} a été déplacé au ${data.date} à ${data.time}. ` +
      `Répondez CANCEL BOOKING pour annuler, STOP pour vous désinscrire.`,

    reviewRequest: (data) =>
      `Comment s'est passé votre ${data.serviceName} chez ${data.businessName} ? Donnez-nous votre avis : ${data.link}`,

    waitlistJoin: (data) =>
      `Vous êtes sur la liste d'attente chez ${data.businessName} pour ${data.serviceName}. Nous vous préviendrons dès qu'un créneau se libère !`,
    waitlistSlotOpen: (data) =>
      `Un créneau vient de s'ouvrir chez ${data.businessName} ! ${data.serviceName} le ${data.date} à ${data.time}. Réservez : ${data.link} — offre valable 4 h.`,
    waitlistExpired: (data) =>
      `Votre demande de liste d'attente chez ${data.businessName} pour ${data.serviceName} a expiré. Consultez ${data.bookingLink} pour les disponibilités.`,

    recurringInitial: (data) =>
      `Votre rendez-vous récurrent ${data.serviceName} chez ${data.businessName} est confirmé le ${data.date} à ${data.time}. Rendez-vous ${data.occurrence} sur ${data.total}. Pour annuler ce rendez-vous, répondez CANCEL BOOKING.`,
    recurringNext: (data) =>
      `Votre prochain rendez-vous récurrent ${data.serviceName} chez ${data.businessName} est réservé le ${data.date} à ${data.time}. Pour annuler, répondez CANCEL BOOKING.`,
    recurringUnavailable: (data) =>
      `Votre rendez-vous récurrent ${data.serviceName} chez ${data.businessName} le ${data.date} n'a pas pu être réservé — le créneau est pris. Réservez un autre horaire : ${data.link}`
  },

  es: {
    confirmation: (data) =>
      `${data.businessName}: Su ${data.serviceName} está confirmado para ${data.date} a las ${data.time}. ` +
      `Responda CANCEL BOOKING para cancelar, STOP para cancelar la suscripción, HELP para ayuda. ` +
      `Pueden aplicar tarifas.`,

    reminder: (data) =>
      `${data.businessName}: Recordatorio — su ${data.serviceName} es mañana a las ${data.time}. ` +
      `Responda CANCEL BOOKING para cancelar, STOP para cancelar la suscripción.`,
    reminderOneHour: (data) =>
      `${data.businessName}: Recordatorio — su ${data.serviceName} comienza en 1 hora. ` +
      `Responda STOP para cancelar la suscripción.`,
    reminderThirtyMin: (data) =>
      `${data.businessName}: Recordatorio — su ${data.serviceName} comienza en 30 min. ` +
      `Responda STOP para cancelar la suscripción.`,

    cancellation: (data) =>
      `${data.businessName}: Su ${data.serviceName} del ${data.date} a las ${data.time} ha sido cancelado. ` +
      `Responda STOP para cancelar la suscripción.`,

    cancelFeeWarning: (data) => data.message,

    reschedule: (data) =>
      `${data.businessName}: Su ${data.serviceName} se ha movido al ${data.date} a las ${data.time}. ` +
      `Responda CANCEL BOOKING para cancelar, STOP para cancelar la suscripción.`,

    reviewRequest: (data) =>
      `¿Cómo fue su ${data.serviceName} en ${data.businessName}? Nos encantaría su opinión: ${data.link}`,

    waitlistJoin: (data) =>
      `Está en la lista de espera en ${data.businessName} para ${data.serviceName}. ¡Le avisaremos cuando haya un hueco!`,
    waitlistSlotOpen: (data) =>
      `¡Acaba de liberarse un hueco en ${data.businessName}! ${data.serviceName} el ${data.date} a las ${data.time}. Reserve: ${data.link} — oferta 4 horas.`,
    waitlistExpired: (data) =>
      `Su solicitud de lista de espera en ${data.businessName} para ${data.serviceName} ha caducado. Visite ${data.bookingLink} para ver disponibilidad.`,

    recurringInitial: (data) =>
      `Su cita recurrente de ${data.serviceName} en ${data.businessName} está confirmada para el ${data.date} a las ${data.time}. Es la cita ${data.occurrence} de ${data.total}. Para cancelar esta cita, responda CANCEL BOOKING.`,
    recurringNext: (data) =>
      `Su próxima cita recurrente de ${data.serviceName} en ${data.businessName} ha sido reservada para el ${data.date} a las ${data.time}. Para cancelar, responda CANCEL BOOKING.`,
    recurringUnavailable: (data) =>
      `No se pudo reservar su cita recurrente de ${data.serviceName} en ${data.businessName} el ${data.date}: el hueco está ocupado. Reserve otra hora: ${data.link}`
  },

  ar: {
    confirmation: (data) =>
      `${data.businessName}: تم تأكيد ${data.serviceName} يوم ${data.date} الساعة ${data.time}. ` +
      `للإلغاء أرسل CANCEL BOOKING. لإلغاء الاشتراك أرسل STOP. للمساعدة أرسل HELP. قد تطبق رسوم.`,

    reminder: (data) =>
      `${data.businessName}: تذكير — موعد ${data.serviceName} غدًا الساعة ${data.time}. ` +
      `للإلغاء أرسل CANCEL BOOKING. لإلغاء الاشتراك أرسل STOP.`,
    reminderOneHour: (data) =>
      `${data.businessName}: تذكير — موعد ${data.serviceName} يبدأ خلال ساعة. ` +
      `لإلغاء الاشتراك أرسل STOP.`,
    reminderThirtyMin: (data) =>
      `${data.businessName}: تذكير — موعد ${data.serviceName} يبدأ خلال 30 دقيقة. ` +
      `لإلغاء الاشتراك أرسل STOP.`,

    cancellation: (data) =>
      `${data.businessName}: تم إلغاء موعد ${data.serviceName} يوم ${data.date} الساعة ${data.time}. ` +
      `لإلغاء الاشتراك أرسل STOP.`,

    /** BOO-45A: fee warning — body must include CONFIRM CANCEL instruction */
    cancelFeeWarning: (data) => data.message,

    reschedule: (data) =>
      `${data.businessName}: تم نقل موعد ${data.serviceName} إلى ${data.date} الساعة ${data.time}. ` +
      `للإلغاء أرسل CANCEL BOOKING. لإلغاء الاشتراك أرسل STOP.`,

    reviewRequest: (data) =>
      `كيف كانت تجربتك مع ${data.serviceName} في ${data.businessName}؟ نقدر رأيك: ${data.link}`,

    waitlistJoin: (data) =>
      `أنت على قائمة الانتظار في ${data.businessName} لخدمة ${data.serviceName}. سنُعلمك عند توفر موعد!`,
    waitlistSlotOpen: (data) =>
      `توفّر موعد في ${data.businessName}! ${data.serviceName} يوم ${data.date} الساعة ${data.time}. احجز الآن: ${data.link} — العرض ينتهي خلال 4 ساعات.`,
    waitlistExpired: (data) =>
      `انتهت صلاحية طلب قائمة الانتظار لدى ${data.businessName} لـ ${data.serviceName}. زُر ${data.bookingLink} للتحقق من المواعيد.`,

    recurringInitial: (data) =>
      `تم تأكيد موعدك المتكرر لـ ${data.serviceName} في ${data.businessName} يوم ${data.date} الساعة ${data.time}. هذا الموعد ${data.occurrence} من ${data.total}. للإلغاء، أرسل CANCEL BOOKING.`,
    recurringNext: (data) =>
      `تم حجز موعدك المتكرر التالي لـ ${data.serviceName} في ${data.businessName} يوم ${data.date} الساعة ${data.time}. للإلغاء، أرسل CANCEL BOOKING.`,
    recurringUnavailable: (data) =>
      `تعذر حجز موعدك المتكرر لـ ${data.serviceName} في ${data.businessName} يوم ${data.date} — الموعد غير متاح. احجز وقتاً آخر: ${data.link}`
  }
};

/**
 * @param {string} language - booking language (e.g. fr, fr-CA)
 * @param {'confirmation'|'reminder'|'reminderOneHour'|'reminderThirtyMin'|'cancellation'|'cancelFeeWarning'|'reviewRequest'|'reschedule'|'waitlistJoin'|'waitlistSlotOpen'|'waitlistExpired'|'recurringInitial'|'recurringNext'|'recurringUnavailable'} type
 */
export function getSmsTemplate(language, type) {
  const lang = normalizeLangCode(language);
  const templates = SMS_TEMPLATES[lang] || SMS_TEMPLATES.en;
  const fn = templates[type] || SMS_TEMPLATES.en[type];
  return fn || SMS_TEMPLATES.en[type];
}

export { SMS_TEMPLATES };

/**
 * BOO-45A: cancellation window, fee amount, and customer-facing messages.
 */

import { isFeatureAllowed } from "../src/config/plans.js";

const DEFAULT_CURRENCY = "cad";

export function resolveCurrency(business) {
  const c = business?.noShowProtection?.currency;
  if (c && typeof c === "string" && c.trim()) return c.trim().toLowerCase();
  return DEFAULT_CURRENCY;
}

/**
 * Whether business may use no-show settings (plan + optional local flag).
 */
export function isNoShowProtectionPlanOk(business) {
  const plan = business?.plan || "starter";
  return isFeatureAllowed(plan, "noShowProtection");
}

export function clampWindowHours(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return 24;
  return Math.max(1, Math.min(72, Math.round(n)));
}

/**
 * Hours from now until slot start (can be negative if past).
 */
export function hoursUntilSlotStart(slotStartIso) {
  const t = new Date(slotStartIso).getTime();
  if (Number.isNaN(t)) return NaN;
  return (t - Date.now()) / 3600000;
}

/**
 * Fee applies when: protection on, within cancellation window before appointment, plan allows feature.
 */
export function feeAppliesForSlot(business, slotStartIso) {
  if (!business?.noShowProtection?.enabled) return false;
  if (!isNoShowProtectionPlanOk(business)) return false;
  const hours = hoursUntilSlotStart(slotStartIso);
  if (Number.isNaN(hours) || hours < 0) return false;
  const windowH = clampWindowHours(business.noShowProtection.cancellationWindowHours);
  return hours <= windowH;
}

/**
 * Fee in major currency units (e.g. dollars), not cents.
 */
export function computeFeeAmountMajor(business, servicePriceMajor) {
  const nsp = business?.noShowProtection || {};
  const feeType = nsp.feeType === "percentage" ? "percentage" : "fixed";
  const feeAmount = Number(nsp.feeAmount);
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) return 0;
  if (feeType === "fixed") return feeAmount;
  const base =
    typeof servicePriceMajor === "number" && Number.isFinite(servicePriceMajor) && servicePriceMajor > 0
      ? servicePriceMajor
      : 0;
  return (feeAmount / 100) * base;
}

export function majorToStripeCents(amountMajor, currency) {
  const cur = (currency || DEFAULT_CURRENCY).toLowerCase();
  const zeroDecimal = new Set(["jpy", "krw", "vnd", "clp", "xaf", "xof"]);
  if (zeroDecimal.has(cur)) return Math.round(amountMajor);
  return Math.round(amountMajor * 100);
}

export function formatMoneyForLocale(amountMajor, currency, lang) {
  const code = (lang || "en").toLowerCase().slice(0, 2);
  const cur = (currency || DEFAULT_CURRENCY).toUpperCase();
  try {
    return new Intl.NumberFormat(code === "fr" ? "fr-CA" : code === "es" ? "es" : "en", {
      style: "currency",
      currency: cur
    }).format(amountMajor);
  } catch {
    return `${amountMajor.toFixed(2)} ${cur}`;
  }
}

/**
 * Multilingual cancellation warning (SMS / UI).
 */
export function cancellationFeeWarningMessage(business, amountMajor, lang) {
  const hours = clampWindowHours(business?.noShowProtection?.cancellationWindowHours);
  const currency = resolveCurrency(business);
  const amt = formatMoneyForLocale(amountMajor, currency, lang);
  const code = (lang || "en").toLowerCase().slice(0, 2);
  if (code === "fr") {
    return `Votre rendez-vous est dans les ${hours} prochaines heures. Annuler maintenant entraînera des frais de ${amt}. Répondez CONFIRM CANCEL pour continuer.`;
  }
  if (code === "es") {
    return `Su cita es en las próximas ${hours} horas. Cancelar ahora tendrá un cargo de ${amt}. Responda CONFIRM CANCEL para continuar.`;
  }
  if (code === "ar") {
    return `موعدك خلال ${hours} ساعة. الإلغاء الآن يفرض رسوماً قدرها ${amt}. أرسل CONFIRM CANCEL للمتابعة.`;
  }
  return `Your appointment is within ${hours} hours. Cancelling now will incur a ${amt} fee. Reply CONFIRM CANCEL to proceed.`;
}

export function buildCancellationInfoPayload(booking, business, service) {
  const nsp = business?.noShowProtection || {};
  const currency = resolveCurrency(business);
  const windowH = clampWindowHours(nsp.cancellationWindowHours);
  const hoursLeft = hoursUntilSlotStart(booking.slot?.start);
  const servicePrice =
    typeof service?.price === "number" && Number.isFinite(service.price) ? service.price : null;
  const feeMajor = computeFeeAmountMajor(business, servicePrice);
  const applies =
    !!nsp.enabled &&
    isNoShowProtectionPlanOk(business) &&
    Number.isFinite(hoursLeft) &&
    hoursLeft >= 0 &&
    hoursLeft <= windowH &&
    feeMajor > 0;

  const lang = booking.language || "en";
  const feeStr = formatMoneyForLocale(feeMajor, currency, lang);
  let message = "";
  if (applies) {
    message = cancellationFeeWarningMessage(business, feeMajor, lang).replace(
      " Répondez CONFIRM CANCEL pour continuer.",
      ""
    );
    message = message.replace(" Responda CONFIRM CANCEL para continuar.", "");
    message = message.replace(" أرسل CONFIRM CANCEL للمتابعة.", "");
    message = message.replace(" Reply CONFIRM CANCEL to proceed.", "");
    message = `${message.trim()} `;
    if (lang.startsWith("fr")) {
      message += `Annuler dans les ${windowH} heures précédant le rendez-vous entraînera des frais de ${feeStr}.`;
    } else if (lang.startsWith("es")) {
      message += `Cancelar dentro de ${windowH} horas de su cita tendrá un cargo de ${feeStr}.`;
    } else if (lang.startsWith("ar")) {
      message += `سيُفرض رسم قدره ${feeStr} عند الإلغاء خلال ${windowH} ساعة من الموعد.`;
    } else {
      message += `Cancelling within ${windowH} hours of your appointment will incur a ${feeStr} fee.`;
    }
  }

  return {
    feeApplies: applies,
    feeAmount: applies ? Math.round(feeMajor * 100) / 100 : 0,
    feeCurrency: currency,
    cancellationWindowHours: windowH,
    hoursUntilAppointment: Number.isFinite(hoursLeft) ? Math.round(hoursLeft * 10) / 10 : null,
    message: message || null
  };
}

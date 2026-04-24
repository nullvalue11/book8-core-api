/**
 * Shared: cancel the customer's next upcoming confirmed booking via SMS (same rules as CANCEL BOOKING).
 * BOO-45A: fee warning + CONFIRM CANCEL when card on file and inside cancellation window.
 */
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { sendCancellation, sendCancellationWithFeeEmail } from "./emailService.js";
import {
  deleteGcalEvent,
  resolveCalendarProviderForBusiness,
  updateGcalEvent
} from "./gcalService.js";
import { nextGcalSyncFromResult } from "./gcalSyncHelpers.js";
import { formatSlotDateTime } from "./localeFormat.js";
import { getSmsTemplate } from "./templates/smsTemplates.js";
import {
  feeAppliesForSlot,
  computeFeeAmountMajor,
  cancellationFeeWarningMessage,
  isNoShowProtectionPlanOk
} from "./noShowProtection.js";
import { tryChargeCancellationFee } from "./bookingFeeCharge.js";
import { notifyWaitlistAfterCancellation } from "./waitlistService.js";

async function notifySmsCancelComplete(booking, business, serviceDisplay, cancellationFeeAmount) {
  const serviceForEmail = await Service.findOne({
    businessId: business.id,
    serviceId: booking.serviceId
  }).lean();

  if (booking.customer?.email) {
    if (cancellationFeeAmount != null && cancellationFeeAmount > 0) {
      sendCancellationWithFeeEmail(
        booking,
        business,
        serviceForEmail || { name: serviceDisplay },
        booking.customer,
        { amountMajor: cancellationFeeAmount }
      ).catch((err) => console.error("[sms-cancel] Cancellation+fee email failed:", err.message));
    } else {
      sendCancellation(
        booking,
        business,
        serviceForEmail || { name: serviceDisplay },
        booking.customer
      ).catch((err) => console.error("[sms-cancel] Cancellation email failed:", err.message));
    }
  }

  const calProvider = resolveCalendarProviderForBusiness(business);
  const bookingKey = booking.id || booking.bookingId;
  const prevSync = booking.gcalSync;

  try {
    if (booking.calendarEventId && calProvider) {
      const result = await updateGcalEvent({
        businessId: booking.businessId,
        eventId: booking.calendarEventId,
        bookingId: bookingKey,
        calendarProvider: calProvider,
        updates: {
          title: `CANCELLED — ${serviceDisplay}`,
          showAs: "free"
        }
      });
      const next = nextGcalSyncFromResult(prevSync, result, "update");
      if (!result.ok && !result.skipped) {
        console.warn("[sms-cancel][gcal-failed]", {
          bookingId: bookingKey,
          businessId: booking.businessId,
          errorType: result.errorType,
          failureCount: next.failureCount
        });
      }
      await Booking.updateOne({ id: bookingKey }, { $set: { gcalSync: next } });
    } else {
      const result = await deleteGcalEvent({
        businessId: booking.businessId,
        booking,
        calendarProvider: calProvider
      });
      const next = nextGcalSyncFromResult(prevSync, result, "delete");
      if (!result.ok && !result.skipped) {
        console.warn("[sms-cancel][gcal-failed]", {
          bookingId: bookingKey,
          businessId: booking.businessId,
          errorType: result.errorType,
          failureCount: next.failureCount
        });
      }
      await Booking.updateOne({ id: bookingKey }, { $set: { gcalSync: next } });
    }
  } catch (err) {
    console.error("[sms-cancel] Calendar side effect failed:", err.message);
  }
}

/**
 * After fee warning, customer texts CONFIRM CANCEL to charge (if applicable) and cancel.
 */
export async function confirmSmsCancelForPhone(business, customerPhoneE164) {
  const now = new Date().toISOString();
  const booking = await Booking.findOne({
    businessId: business.id,
    "customer.phone": customerPhoneE164,
    status: "confirmed",
    smsCancelAwaitingConfirm: true,
    "slot.start": { $gt: now }
  })
    .sort({ "slot.start": 1 })
    .lean();

  if (!booking) {
    return {
      ok: false,
      reply: "No pending cancellation to confirm. Text CANCEL BOOKING to cancel an appointment."
    };
  }

  const service = await Service.findOne({
    businessId: business.id,
    serviceId: booking.serviceId
  }).lean();

  const feeTry = await tryChargeCancellationFee(booking, business, service);
  if (!feeTry.ok) {
    return {
      ok: false,
      reply:
        "We could not process the payment for this cancellation. Please call the business to complete cancellation."
    };
  }

  const feeSet =
    feeTry.charged && feeTry.paymentIntentId
      ? {
          cancellationFeeCharged: true,
          cancellationFeeChargedAt: new Date(),
          cancellationFeeAmount: feeTry.amountMajor,
          cancellationFeeChargeId: feeTry.paymentIntentId
        }
      : {};

  await Booking.updateOne(
    { id: booking.id },
    {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationMethod: "sms",
        smsCancelAwaitingConfirm: false,
        ...feeSet
      }
    }
  );

  const tz = business.timezone || "America/Toronto";
  const lang = booking.language || "en";
  const { dateStr, timeStr } = formatSlotDateTime(booking.slot.start, tz, lang);
  let serviceDisplay = booking.serviceId || "Appointment";
  if (service?.name) serviceDisplay = service.name;

  await notifySmsCancelComplete(
    booking,
    business,
    serviceDisplay,
    feeTry.charged ? feeTry.amountMajor : undefined
  );

  const cancelTpl = getSmsTemplate(lang, "cancellation");
  const replyMsg = cancelTpl({
    serviceName: serviceDisplay,
    businessName: business.name || business.id,
    date: dateStr,
    time: timeStr,
    customerName: ""
  });

  console.log("[sms-cancel] Booking cancelled (confirmed):", booking.id);
  notifyWaitlistAfterCancellation(booking);
  return { ok: true, reply: replyMsg };
}

export async function cancelUpcomingBookingForPhone(business, customerPhoneE164) {
  const now = new Date().toISOString();
  const booking = await Booking.findOne({
    businessId: business.id,
    "customer.phone": customerPhoneE164,
    status: "confirmed",
    "slot.start": { $gt: now }
  })
    .sort({ "slot.start": 1 })
    .lean();

  if (!booking) {
    return {
      ok: false,
      reply: "No upcoming appointment found to cancel. Call us if you need help."
    };
  }

  const service = await Service.findOne({
    businessId: business.id,
    serviceId: booking.serviceId
  }).lean();

  const nspOn =
    business.noShowProtection?.enabled &&
    isNoShowProtectionPlanOk(business) &&
    booking.stripePaymentMethodId;

  const inFeeWindow = feeAppliesForSlot(business, booking.slot.start);

  if (nspOn && inFeeWindow && !booking.smsCancelAwaitingConfirm) {
    await Booking.updateOne(
      { id: booking.id },
      {
        $set: {
          smsCancelAwaitingConfirm: true,
          smsCancelPromptSentAt: new Date()
        }
      }
    );
    const lang = booking.language || "en";
    const feeMajor = computeFeeAmountMajor(business, service?.price ?? null);
    const msg = cancellationFeeWarningMessage(business, feeMajor, lang);
    const tpl = getSmsTemplate(lang, "cancelFeeWarning");
    return { ok: true, reply: tpl({ message: msg }) };
  }

  if (booking.smsCancelAwaitingConfirm && nspOn && inFeeWindow) {
    const lang = booking.language || "en";
    const feeMajor = computeFeeAmountMajor(business, service?.price ?? null);
    const msg = cancellationFeeWarningMessage(business, feeMajor, lang);
    const tpl = getSmsTemplate(lang, "cancelFeeWarning");
    return { ok: true, reply: tpl({ message: msg }) };
  }

  const feeTry = await tryChargeCancellationFee(booking, business, service);
  if (!feeTry.ok) {
    return {
      ok: false,
      reply:
        "We could not complete cancellation (payment issue). Please call the business for help."
    };
  }

  const feeSet =
    feeTry.charged && feeTry.paymentIntentId
      ? {
          cancellationFeeCharged: true,
          cancellationFeeChargedAt: new Date(),
          cancellationFeeAmount: feeTry.amountMajor,
          cancellationFeeChargeId: feeTry.paymentIntentId
        }
      : {};

  await Booking.updateOne(
    { id: booking.id },
    {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationMethod: "sms",
        smsCancelAwaitingConfirm: false,
        ...feeSet
      }
    }
  );

  const tz = business.timezone || "America/Toronto";
  const lang = booking.language || "en";
  const { dateStr, timeStr } = formatSlotDateTime(booking.slot.start, tz, lang);
  let serviceDisplay = booking.serviceId || "Appointment";
  if (service?.name) serviceDisplay = service.name;

  await notifySmsCancelComplete(
    booking,
    business,
    serviceDisplay,
    feeTry.charged ? feeTry.amountMajor : undefined
  );

  const cancelTpl = getSmsTemplate(lang, "cancellation");
  const replyMsg = cancelTpl({
    serviceName: serviceDisplay,
    businessName: business.name || business.id,
    date: dateStr,
    time: timeStr,
    customerName: ""
  });

  console.log("[sms-cancel] Booking cancelled:", booking.id);
  notifyWaitlistAfterCancellation(booking);
  return { ok: true, reply: replyMsg };
}

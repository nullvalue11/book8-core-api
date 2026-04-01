/**
 * Shared: cancel the customer's next upcoming confirmed booking via SMS (same rules as CANCEL BOOKING).
 * @param {object} business — lean Business doc (must have .id)
 * @param {string} customerPhoneE164 — Twilio From
 * @returns {Promise<{ ok: boolean, reply: string }>}
 */
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { sendCancellation } from "./emailService.js";
import {
  deleteGcalEvent,
  resolveCalendarProviderForBusiness,
  updateGcalEvent
} from "./gcalService.js";
import { formatSlotDateTime } from "./localeFormat.js";
import { getSmsTemplate } from "./templates/smsTemplates.js";

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

  await Booking.updateOne(
    { id: booking.id },
    {
      $set: {
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationMethod: "sms"
      }
    }
  );

  const tz = business.timezone || "America/Toronto";
  const lang = booking.language || "en";
  const { dateStr, timeStr } = formatSlotDateTime(booking.slot.start, tz, lang);
  let serviceDisplay = booking.serviceId || "Appointment";
  try {
    const svc = await Service.findOne({ businessId: business.id, serviceId: booking.serviceId }).lean();
    if (svc?.name) serviceDisplay = svc.name;
  } catch {
    // keep
  }
  const cancelTpl = getSmsTemplate(lang, "cancellation");
  const replyMsg = cancelTpl({
    serviceName: serviceDisplay,
    businessName: business.name || business.id,
    date: dateStr,
    time: timeStr,
    customerName: ""
  });

  if (booking.customer?.email) {
    const serviceForEmail = await Service.findOne({
      businessId: business.id,
      serviceId: booking.serviceId
    }).lean();
    sendCancellation(booking, business, serviceForEmail || { name: serviceDisplay }, booking.customer).catch((err) =>
      console.error("[sms-cancel] Cancellation email failed:", err.message)
    );
  }

  const calProvider = resolveCalendarProviderForBusiness(business);
  if (booking.calendarEventId && calProvider) {
    updateGcalEvent({
      businessId: booking.businessId,
      eventId: booking.calendarEventId,
      bookingId: booking.id || booking.bookingId,
      calendarProvider: calProvider,
      updates: {
        title: `CANCELLED — ${serviceDisplay}`,
        showAs: "free"
      }
    }).catch((err) => console.error("[sms-cancel] Calendar update failed:", err.message));
  } else {
    deleteGcalEvent({
      businessId: booking.businessId,
      bookingId: booking.id || booking.bookingId,
      calendarProvider: calProvider
    }).catch((err) => console.error("[sms-cancel] Calendar delete failed:", err.message));
  }

  console.log("[sms-cancel] Booking cancelled:", booking.id);
  return { ok: true, reply: replyMsg };
}

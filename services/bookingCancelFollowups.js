/**
 * Shared calendar + email + SMS/WhatsApp notifications after a booking is marked cancelled.
 * Extracted from src/routes/bookings.js (BOO-INFOBIP-AI-HANDLER-1A) for reuse by WhatsApp AI tools.
 */
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import {
  deleteGcalEvent,
  resolveCalendarProviderForBusiness,
  updateGcalEvent
} from "./gcalService.js";
import { nextGcalSyncFromResult } from "./gcalSyncHelpers.js";
import { sendCancellation, sendCancellationWithFeeEmail } from "./emailService.js";
import { notifyWaitlistAfterCancellation } from "./waitlistService.js";
import { getMessagingProvider } from "./messaging/messagingFactory.js";
import { canSendTransactionalMessage } from "./messaging/bspRouting.js";
import { isFeatureAllowed } from "./planLimits.js";
import { formatSlotDateTime } from "./localeFormat.js";

/** Match by custom `id` (e.g. bk_…) and/or Mongo `_id` without casting bk_* to ObjectId. */
export function bookingLookupFilter(bookingId) {
  const or = [{ id: bookingId }];
  if (mongoose.isValidObjectId(bookingId)) {
    or.push({ _id: bookingId });
  }
  return { $or: or };
}

export async function runBookingCancellationFollowups(booking, options = {}) {
  const { cancellationFeeAmount } = options;
  const business = await Business.findOne({ id: booking.businessId }).lean();
  const calProvider = resolveCalendarProviderForBusiness(business);

  let serviceDisplay = booking.serviceId || "Appointment";
  try {
    const svc = await Service.findOne({ businessId: booking.businessId, serviceId: booking.serviceId }).lean();
    if (svc?.name) serviceDisplay = svc.name;
  } catch {
    // keep fallback
  }

  const bookingIdStr = booking.id || booking._id?.toString();
  const prevSync = booking.gcalSync;

  try {
    if (booking.calendarEventId && calProvider) {
      const result = await updateGcalEvent({
        businessId: booking.businessId,
        eventId: booking.calendarEventId,
        bookingId: bookingIdStr,
        calendarProvider: calProvider,
        updates: {
          title: `CANCELLED — ${serviceDisplay}`,
          showAs: "free"
        }
      });
      const next = nextGcalSyncFromResult(prevSync, result, "update");
      if (!result.ok && !result.skipped) {
        console.warn("[booking-cancel][gcal-failed]", {
          bookingId: bookingIdStr,
          businessId: booking.businessId,
          errorType: result.errorType,
          failureCount: next.failureCount
        });
      }
      await Booking.updateOne(bookingLookupFilter(bookingIdStr), { $set: { gcalSync: next } });
    } else {
      const result = await deleteGcalEvent({
        businessId: booking.businessId,
        booking,
        calendarProvider: calProvider
      });
      const next = nextGcalSyncFromResult(prevSync, result, "delete");
      if (!result.ok && !result.skipped) {
        console.warn("[booking-cancel][gcal-failed]", {
          bookingId: bookingIdStr,
          businessId: booking.businessId,
          errorType: result.errorType,
          failureCount: next.failureCount
        });
      }
      await Booking.updateOne(bookingLookupFilter(bookingIdStr), { $set: { gcalSync: next } });
    }
  } catch (err) {
    console.error("[bookings.cancel] Calendar side effect failed:", err.message);
  }

  if (booking.customer?.email) {
    (async () => {
      try {
        let serviceDisplayEmail = booking.serviceId || "Appointment";
        let serviceForEmail = { name: serviceDisplayEmail };
        try {
          const svc = await Service.findOne({ businessId: booking.businessId, serviceId: booking.serviceId }).lean();
          if (svc?.name) {
            serviceDisplayEmail = svc.name;
            serviceForEmail = svc;
          }
        } catch {
          // keep fallback
        }
        if (cancellationFeeAmount != null && cancellationFeeAmount > 0) {
          await sendCancellationWithFeeEmail(
            booking,
            business || { id: booking.businessId, name: booking.businessId },
            serviceForEmail,
            booking.customer,
            { amountMajor: cancellationFeeAmount }
          );
        } else {
          await sendCancellation(
            booking,
            business || { id: booking.businessId, name: booking.businessId },
            serviceForEmail,
            booking.customer
          );
        }
      } catch (err) {
        console.error("[bookings.cancel] Cancellation email failed:", err.message);
      }
    })().catch(() => {});
  }

  notifyWaitlistAfterCancellation(booking);

  if (
    booking.customer?.phone &&
    business &&
    canSendTransactionalMessage(business, booking.customer.phone) &&
    isFeatureAllowed(business.plan || "starter", "smsConfirmations")
  ) {
    const tz = business.timezone || booking.slot?.timezone || "America/Toronto";
    const lang = booking.language || "en";
    const { dateStr, timeStr } = formatSlotDateTime(booking.slot?.start, tz, lang);
    const provider = getMessagingProvider(business);
    provider
      .sendCancelNotification(business, booking.customer, {
        language: lang,
        serviceName: serviceDisplay,
        businessName: business.name || booking.businessId,
        slotLocalDate: dateStr,
        slotLocalTime: timeStr
      })
      .catch((err) =>
        console.error("[bookings.cancel] Cancellation SMS/WhatsApp failed:", err.message)
      );
  }
}

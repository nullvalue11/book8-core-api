// BOO-58A: send post-appointment review requests from cron (Growth+); Starter marks sent without messaging.
import { Booking } from "../models/Booking.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { sendSMS, formatReviewRequestSMS } from "./smsService.js";
import { sendReviewRequestEmail } from "./emailService.js";
import { signReviewToken } from "./reviewToken.js";
import { isFeatureAllowed } from "./planLimits.js";

function reviewAppOrigin() {
  const o = process.env.PUBLIC_APP_ORIGIN || "https://www.book8.io";
  return String(o).replace(/\/$/, "");
}

/**
 * @returns {Promise<{ processed: number, sent: number, failed: number, skippedStarter: number }>}
 */
export async function processReviewRequests() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const twoHoursAgoIso = twoHoursAgo.toISOString();

  const candidates = await Booking.find({
    status: "confirmed",
    reviewRequestSent: { $ne: true },
    "slot.end": { $lt: twoHoursAgoIso }
  }).lean();

  let marked = 0;
  let failed = 0;
  let skippedStarter = 0;

  for (const booking of candidates) {
    try {
      const business = await Business.findOne({
        $or: [{ id: booking.businessId }, { businessId: booking.businessId }]
      }).lean();

      if (!business) {
        console.warn(`[review-requests] No business for booking ${booking.id}`);
        failed++;
        continue;
      }

      const plan = business.plan || "starter";

      if (!isFeatureAllowed(plan, "reviewRequests")) {
        await Booking.updateOne(
          { id: booking.id },
          { $set: { reviewRequestSent: true, reviewRequestSentAt: new Date() } }
        );
        skippedStarter++;
        marked++;
        continue;
      }

      let serviceName = booking.serviceId || "Appointment";
      try {
        const svc = await Service.findOne({
          businessId: booking.businessId,
          serviceId: booking.serviceId
        }).lean();
        if (svc?.name) serviceName = svc.name;
      } catch {
        // ignore
      }

      const businessName = business.name || booking.businessId;
      const token = signReviewToken(booking.id, booking.businessId);
      const link = `${reviewAppOrigin()}/review/${token}`;

      const customerPhone = booking.customer?.phone;
      const fromNumber = business.assignedTwilioNumber;
      const smsBody = formatReviewRequestSMS({
        serviceName,
        businessName,
        link,
        language: booking.language
      });

      if (customerPhone && fromNumber) {
        await sendSMS({
          to: customerPhone,
          from: fromNumber,
          body: smsBody
        });
      }

      if (booking.customer?.email) {
        await sendReviewRequestEmail(booking, business, { name: serviceName }, booking.customer, {
          link
        });
      }

      if (!customerPhone && !booking.customer?.email) {
        console.warn(`[review-requests] No phone or email for booking ${booking.id}`);
      }

      await Booking.updateOne(
        { id: booking.id },
        { $set: { reviewRequestSent: true, reviewRequestSentAt: new Date() } }
      );
      marked++;
    } catch (err) {
      console.error(`[review-requests] Error for booking ${booking.id}:`, err.message);
      failed++;
    }
  }

  return {
    processed: candidates.length,
    marked,
    failed,
    skippedStarter
  };
}

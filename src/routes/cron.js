// BOO-63A — /api/cron/* (moved from index.js; behavior unchanged)
import express from "express";
import twilio from "twilio";
import { Booking } from "../../models/Booking.js";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { TwilioNumber } from "../../models/TwilioNumber.js";
import { sendSMS, formatReminderSMS } from "../../services/smsService.js";
import { sendReminder as sendReminderEmail } from "../../services/emailService.js";
import { safeCompare } from "../middleware/internalAuth.js";
import { isFeatureAllowed } from "../../services/planLimits.js";
import { processReviewRequests } from "../../services/reviewRequestCron.js";
import { processWaitlistCronJobs } from "../../services/waitlistService.js";
import { processRecurringBookingCron } from "../../services/recurringBookingCron.js";
import { configureTwilioVoiceForPoolNumber } from "../../services/twilioNumberSetup.js";
import { runTrialNotifications } from "../../services/trialNotifications.js";

const router = express.Router();

router.get("/send-reminders", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token =
      authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || !token || !safeCompare(token, expectedSecret)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const bookingsToRemind = await Booking.find({
      status: "confirmed",
      reminderSentAt: { $exists: false },
      "slot.start": { $gte: in24Hours.toISOString(), $lte: in25Hours.toISOString() }
    }).lean();

    console.log(`[send-reminders] Found ${bookingsToRemind.length} bookings to remind`);

    let sent = 0;
    let failed = 0;

    for (const booking of bookingsToRemind) {
      try {
        const customerPhone = booking.customer?.phone;
        if (!customerPhone) {
          console.log(`[send-reminders] No phone for booking ${booking.id} — skipping`);
          continue;
        }

        const business = await Business.findOne({ id: booking.businessId }).lean();
        const fromNumber = business?.assignedTwilioNumber;
        if (!fromNumber) {
          console.log(`[send-reminders] No Twilio number for business ${booking.businessId} — skipping`);
          continue;
        }

        const plan = business?.plan || "starter";
        const smsAllowed = isFeatureAllowed(plan, "smsConfirmations");

        const tz = business?.timezone || booking.slot?.timezone || "America/Toronto";
        const slotDate = new Date(booking.slot.start);
        const dateStr = slotDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: tz
        });
        const timeStr = slotDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: tz
        });

        let serviceName = booking.serviceId || "Appointment";
        try {
          const svc = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          if (svc) serviceName = svc.name;
        } catch {
          // use fallback
        }

        const smsBody = formatReminderSMS({
          serviceName,
          businessName: business.name || booking.businessId,
          date: dateStr,
          time: timeStr,
          isOneHour: false
        });

        if (smsAllowed) {
          const smsResult = await sendSMS({
            to: customerPhone,
            from: fromNumber,
            body: smsBody
          });

          if (smsResult.ok) {
            await Booking.findOneAndUpdate(
              { id: booking.id },
              { $set: { reminderSentAt: new Date(), reminderSid: smsResult.messageSid } }
            );
            sent++;
          } else {
            failed++;
          }
        } else {
          console.log(
            `[send-reminders] SMS skipped — plan "${plan}" has no smsConfirmations (${booking.businessId})`
          );
          await Booking.findOneAndUpdate(
            { id: booking.id },
            { $set: { reminderSentAt: new Date() } }
          );
        }

        if (booking.customer?.email && !booking.reminderEmailSentAt) {
          const svcForEmail = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          sendReminderEmail(booking, business, svcForEmail || { name: serviceName }, booking.customer, "24h")
            .then(async (result) => {
              if (result?.id) {
                await Booking.findOneAndUpdate(
                  { id: booking.id },
                  { $set: { reminderEmailSentAt: new Date(), reminderEmailId: result.id } }
                );
              }
            })
            .catch((err) => console.error("[send-reminders] Reminder email failed:", err.message));
        }
      } catch (err) {
        console.error(`[send-reminders] Error processing booking ${booking.id}:`, err);
        failed++;
      }
    }

    const in1Hour = new Date(now.getTime() + 60 * 60 * 1000);
    const in90Min = new Date(now.getTime() + 90 * 60 * 1000);

    const shortReminders = await Booking.find({
      status: "confirmed",
      shortReminderSentAt: { $exists: false },
      "slot.start": { $gte: in1Hour.toISOString(), $lte: in90Min.toISOString() }
    }).lean();

    console.log(`[send-reminders] Found ${shortReminders.length} bookings for 1-hour reminder`);

    for (const booking of shortReminders) {
      try {
        const customerPhone = booking.customer?.phone;
        if (!customerPhone) continue;

        const business = await Business.findOne({ id: booking.businessId }).lean();
        const fromNumber = business?.assignedTwilioNumber;
        if (!fromNumber) continue;

        const plan = business?.plan || "starter";
        const smsAllowed = isFeatureAllowed(plan, "smsConfirmations");

        let serviceName = booking.serviceId || "Appointment";
        try {
          const svc = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          if (svc) serviceName = svc.name;
        } catch {
          // use fallback
        }

        const smsBody = formatReminderSMS({
          serviceName,
          businessName: business.name || booking.businessId,
          date: "",
          time: "",
          isOneHour: true
        });

        if (smsAllowed) {
          const smsResult = await sendSMS({
            to: customerPhone,
            from: fromNumber,
            body: smsBody
          });

          if (smsResult.ok) {
            await Booking.findOneAndUpdate(
              { id: booking.id },
              { $set: { shortReminderSentAt: new Date(), shortReminderSid: smsResult.messageSid } }
            );
            sent++;
          } else {
            failed++;
          }
        } else {
          console.log(
            `[send-reminders] 1h SMS skipped — plan "${plan}" has no smsConfirmations (${booking.businessId})`
          );
          await Booking.findOneAndUpdate(
            { id: booking.id },
            { $set: { shortReminderSentAt: new Date() } }
          );
        }

        if (booking.customer?.email && !booking.shortReminderEmailSentAt) {
          const svcForEmail = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          sendReminderEmail(booking, business, svcForEmail || { name: serviceName }, booking.customer, "1h")
            .then(async (result) => {
              if (result?.id) {
                await Booking.findOneAndUpdate(
                  { id: booking.id },
                  { $set: { shortReminderEmailSentAt: new Date(), shortReminderEmailId: result.id } }
                );
              }
            })
            .catch((err) => console.error("[send-reminders] 1h reminder email failed:", err.message));
        }
      } catch (err) {
        console.error(`[send-reminders] Error on 1-hour reminder for ${booking.id}:`, err);
        failed++;
      }
    }

    const in30Min = new Date(now.getTime() + 30 * 60 * 1000);
    const in45Min = new Date(now.getTime() + 45 * 60 * 1000);

    const lastMinuteReminders = await Booking.find({
      status: "confirmed",
      lastMinuteReminderSentAt: { $exists: false },
      "slot.start": { $gte: in30Min.toISOString(), $lte: in45Min.toISOString() }
    }).lean();

    console.log(`[send-reminders] Found ${lastMinuteReminders.length} bookings for 30-minute reminder`);

    for (const booking of lastMinuteReminders) {
      try {
        const customerPhone = booking.customer?.phone;
        if (!customerPhone) continue;

        const business = await Business.findOne({ id: booking.businessId }).lean();
        const fromNumber = business?.assignedTwilioNumber;
        if (!fromNumber) continue;

        const plan = business?.plan || "starter";
        const smsAllowed = isFeatureAllowed(plan, "smsConfirmations");

        let serviceName = booking.serviceId || "Appointment";
        try {
          const svc = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          if (svc) serviceName = svc.name;
        } catch {
          // use fallback
        }

        const smsBody = formatReminderSMS({
          serviceName,
          businessName: business.name || booking.businessId,
          date: "",
          time: "",
          isOneHour: false,
          isThirtyMinutes: true
        });

        if (smsAllowed) {
          const smsResult = await sendSMS({
            to: customerPhone,
            from: fromNumber,
            body: smsBody
          });

          if (smsResult.ok) {
            await Booking.findOneAndUpdate(
              { id: booking.id },
              {
                $set: {
                  lastMinuteReminderSentAt: new Date(),
                  lastMinuteReminderSid: smsResult.messageSid
                }
              }
            );
            sent++;
          } else {
            failed++;
          }
        } else {
          console.log(
            `[send-reminders] 30min SMS skipped — plan "${plan}" has no smsConfirmations (${booking.businessId})`
          );
          await Booking.findOneAndUpdate(
            { id: booking.id },
            { $set: { lastMinuteReminderSentAt: new Date() } }
          );
        }

        if (booking.customer?.email && !booking.lastMinuteReminderEmailSentAt) {
          const svcForEmail = await Service.findOne({
            businessId: booking.businessId,
            serviceId: booking.serviceId
          }).lean();
          sendReminderEmail(booking, business, svcForEmail || { name: serviceName }, booking.customer, "30min")
            .then(async (result) => {
              if (result?.id) {
                await Booking.findOneAndUpdate(
                  { id: booking.id },
                  { $set: { lastMinuteReminderEmailSentAt: new Date(), lastMinuteReminderEmailId: result.id } }
                );
              }
            })
            .catch((err) => console.error("[send-reminders] 30min reminder email failed:", err.message));
        }
      } catch (err) {
        console.error(`[send-reminders] Error on 30-minute reminder for ${booking.id}:`, err);
        failed++;
      }
    }

    console.log(`[send-reminders] Done: ${sent} sent, ${failed} failed`);

    let reviewRequests = { processed: 0, marked: 0, failed: 0, skippedStarter: 0 };
    try {
      reviewRequests = await processReviewRequests();
    } catch (rrErr) {
      console.error("[send-reminders] reviewRequests:", rrErr.message);
    }

    let waitlistCron = { expiredWaiting: 0, expiredNotifications: 0, renotified: 0 };
    try {
      waitlistCron = await processWaitlistCronJobs();
    } catch (wlErr) {
      console.error("[send-reminders] waitlistCron:", wlErr.message);
    }

    let recurringCron = { created: 0, failed: 0, skipped: 0 };
    try {
      recurringCron = await processRecurringBookingCron();
    } catch (rbErr) {
      console.error("[send-reminders] recurringCron:", rbErr.message);
    }

    return res.json({
      ok: true,
      processed:
        bookingsToRemind.length + shortReminders.length + lastMinuteReminders.length,
      sent,
      failed,
      reviewRequests,
      waitlistCron,
      recurringCron
    });
  } catch (err) {
    console.error("[send-reminders] Error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/replenish-pool", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token =
      authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || !token || !safeCompare(token, expectedSecret)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const availableCount = await TwilioNumber.countDocuments({ status: "available" });
    if (availableCount >= 3) {
      return res.json({ ok: true, available: availableCount, purchased: 0 });
    }

    const needed = 5 - availableCount;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      return res.status(503).json({ ok: false, error: "Twilio not configured" });
    }

    const twilioClient = twilio(accountSid, authToken);
    const available = await twilioClient.availablePhoneNumbers("CA").local.list({
      smsEnabled: true,
      voiceEnabled: true,
      limit: needed
    });

    let purchasedCount = 0;
    for (const num of available) {
      try {
        const purchased = await twilioClient.incomingPhoneNumbers.create({
          phoneNumber: num.phoneNumber
        });
        await TwilioNumber.create({
          phoneNumber: purchased.phoneNumber,
          twilioSid: purchased.sid,
          areaCode: purchased.phoneNumber.slice(2, 5),
          status: "available",
          capabilities: { voice: true, sms: true }
        });
        purchasedCount++;
        const voiceOk = await configureTwilioVoiceForPoolNumber(purchased.sid);
        if (!voiceOk) {
          console.warn(
            "[replenish] Purchased",
            purchased.phoneNumber,
            "— voice webhook not set; configure manually or re-run assignment flow"
          );
        }
      } catch (err) {
        console.error("[replenish] Failed to purchase", num.phoneNumber, err.message);
      }
    }

    const newAvailable = await TwilioNumber.countDocuments({ status: "available" });
    return res.json({ ok: true, available: newAvailable, purchased: purchasedCount });
  } catch (err) {
    console.error("[replenish-pool] Error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/trial-notifications", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token =
      authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret || !token || !safeCompare(token, expectedSecret)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const result = await runTrialNotifications(new Date());
    console.log("[trial-notifications] cron result:", result);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[trial-notifications] Error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

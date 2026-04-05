// BOO-60A: cron — create next occurrence within 48h window
import { Booking } from "../models/Booking.js";
import { Business } from "../models/Business.js";
import { createBooking } from "./bookingService.js";
import { computeNextSlotStartIso, calendarDateYmd } from "./recurringBookingUtils.js";
import { sendRecurringSlotUnavailableNotifications } from "./recurringBookingMessages.js";

function buildCronRecurringMetadata(parent, nextStartIso, durationMinutes) {
  const r = parent.recurring;
  const occ = r.occurrenceNumber + 1;
  const total = r.totalOccurrences;
  const freq = r.frequency;
  const intervalDays = r.intervalDays;
  const tz = parent.slot.timezone;

  let nextSlotStart = null;
  let nextBookingDate = null;
  if (occ < total) {
    nextSlotStart = computeNextSlotStartIso(nextStartIso, freq, intervalDays);
    if (nextSlotStart) nextBookingDate = calendarDateYmd(nextSlotStart, tz);
  }

  return {
    enabled: true,
    frequency: freq,
    intervalDays: freq === "custom" ? intervalDays : undefined,
    seriesId: r.seriesId,
    occurrenceNumber: occ,
    totalOccurrences: total,
    nextBookingDate,
    nextSlotStart: nextSlotStart || undefined,
    autoRenew: r.autoRenew !== false,
    endDate: r.endDate,
    cancelledFromSeries: false
  };
}

/**
 * Create follow-up bookings when nextSlotStart falls within [now, now+48h].
 * @returns {Promise<{ created: number, failed: number, skipped: number }>}
 */
export async function processRecurringBookingCron() {
  const now = Date.now();
  const windowEnd = now + 48 * 60 * 60 * 1000;

  const candidates = await Booking.find({
    "recurring.enabled": true,
    "recurring.autoRenew": { $ne: false },
    status: "confirmed",
    "recurring.nextSlotStart": { $exists: true, $nin: [null, ""] },
    $expr: { $lt: ["$recurring.occurrenceNumber", "$recurring.totalOccurrences"] }
  }).lean();

  let created = 0;
  let failed = 0;
  let skipped = 0;

  for (const parent of candidates) {
    const nextMs = new Date(parent.recurring.nextSlotStart).getTime();
    if (Number.isNaN(nextMs) || nextMs < now || nextMs > windowEnd) {
      skipped++;
      continue;
    }

    const exists = await Booking.findOne({
      "recurring.seriesId": parent.recurring.seriesId,
      "recurring.occurrenceNumber": parent.recurring.occurrenceNumber + 1
    }).lean();
    if (exists) {
      await Booking.updateOne({ id: parent.id }, { $unset: { "recurring.nextSlotStart": 1 } });
      skipped++;
      continue;
    }

    const durationMs = new Date(parent.slot.end) - new Date(parent.slot.start);
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
    const nextStart = parent.recurring.nextSlotStart;
    const nextEnd = new Date(new Date(nextStart).getTime() + durationMinutes * 60000).toISOString();

    const recurringMetadata = buildCronRecurringMetadata(parent, nextStart, durationMinutes);

    const result = await createBooking({
      businessId: parent.businessId,
      serviceId: parent.serviceId,
      customer: parent.customer,
      slot: {
        start: nextStart,
        end: nextEnd,
        timezone: parent.slot.timezone
      },
      source: parent.source || "web",
      language: parent.language,
      providerId: parent.providerId,
      providerName: parent.providerName,
      notes: parent.notes || "",
      recurringMetadata,
      _recurringCron: true
    });

    if (!result.ok) {
      failed++;
      try {
        const business = await Business.findOne({ id: parent.businessId }).lean();
        if (business) {
          await sendRecurringSlotUnavailableNotifications(
            business,
            parent,
            recurringMetadata.nextBookingDate || nextStart.slice(0, 10)
          );
        }
      } catch (e) {
        console.error("[recurring cron] notify fail:", e.message);
      }
      await Booking.updateOne(
        { id: parent.id },
        { $set: { "recurring.autoRenew": false } }
      );
      continue;
    }

    await Booking.updateOne({ id: parent.id }, { $unset: { "recurring.nextSlotStart": 1 } });
    created++;
  }

  return { created, failed, skipped };
}

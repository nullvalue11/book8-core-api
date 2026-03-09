/**
 * Booking creation and slot availability check.
 */

import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { formatSlotDisplay } from "./slotDisplay.js";
import { randomBytes } from "crypto";

/**
 * Generate a stable booking id (e.g. bk_01JQBOOK8XYZ).
 */
export function generateBookingId() {
  const suffix = randomBytes(9).toString("base64url").replace(/[-_]/g, "X").slice(0, 12);
  return `bk_${suffix}`;
}

/**
 * Check if the given slot is still available (not double-booked).
 * Ensures no existing confirmed booking for this business overlaps the slot.
 */
export async function isSlotAvailable(businessId, slot) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return false;
  }
  const overlapping = await Booking.findOne({
    businessId,
    status: "confirmed",
    $or: [
      { "slot.start": { $lt: slot.end }, "slot.end": { $gt: slot.start } }
    ]
  }).lean();
  return !overlapping;
}

/**
 * Create a booking. Validates business, checks slot availability, then persists.
 * @param {object} input
 * @returns {Promise<{ ok: boolean, error?: string, booking?: object, summary?: string }>}
 */
export async function createBooking(input) {
  const { businessId, serviceId, customer, slot, notes, source } = input;

  if (!businessId || !serviceId) {
    return { ok: false, error: "businessId and serviceId are required" };
  }
  if (!customer?.name) {
    return { ok: false, error: "Customer name is required" };
  }
  if (!slot?.start || !slot?.end || !slot?.timezone) {
    return { ok: false, error: "Slot start, end, and timezone are required" };
  }

  const business = await Business.findOne({ id: businessId }).lean();
  if (!business) {
    return { ok: false, error: "Business not found" };
  }

  const service = await Service.findOne({ businessId, serviceId }).lean();
  if (!service) {
    return { ok: false, error: "Service not found" };
  }
  if (!service.active) {
    return { ok: false, error: "Service is not active" };
  }

  const slotDurationMs = new Date(slot.end) - new Date(slot.start);
  const slotDurationMinutes = Math.round(slotDurationMs / 60000);
  if (slotDurationMinutes < service.durationMinutes) {
    return { ok: false, error: "Slot duration is shorter than service duration" };
  }
  if (slotDurationMinutes > service.durationMinutes + 15) {
    return { ok: false, error: "Slot duration does not match service duration" };
  }

  const available = await isSlotAvailable(businessId, slot);
  if (!available) {
    return { ok: false, error: "Selected slot is no longer available" };
  }

  const bookingId = generateBookingId();
  const timezone = slot.timezone || business.timezone || "America/Toronto";

  const booking = new Booking({
    id: bookingId,
    businessId,
    serviceId: serviceId || "",
    customer: {
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || ""
    },
    slot: {
      start: slot.start,
      end: slot.end,
      timezone
    },
    status: "confirmed",
    source: source || "voice-agent",
    notes: notes || ""
  });

  await booking.save();

  const display = formatSlotDisplay(slot.start, timezone);
  const summary = `Booked ${customer.name} for ${display}.`;

  return {
    ok: true,
    booking: {
      id: booking.id,
      businessId: booking.businessId,
      serviceId: booking.serviceId,
      customer: booking.customer,
      slot: booking.slot,
      status: booking.status
    },
    summary
  };
}

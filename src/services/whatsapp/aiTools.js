// BOO-INFOBIP-AI-HANDLER-1A — Anthropic tool schemas + booking tool dispatch
import { fromZonedTime } from "date-fns-tz";
import { addDays, format } from "date-fns";
import { getAvailability } from "../../../services/calendarAvailability.js";
import {
  createBooking,
  lookupBookingsByPhone,
  rescheduleBooking,
  cancelBookingForCustomerChannel
} from "../../../services/bookingService.js";

function tenantBusinessId(ctx) {
  const b = ctx.business;
  return (b?.id || b?.businessId || "").trim();
}

export function getToolDefinitions() {
  return [
    {
      name: "get_business_info",
      description:
        "Get information about the business: services offered, hours, location, and booking policies. Call this if the customer asks about what services are available, when the business is open, or where they're located.",
      input_schema: { type: "object", properties: {}, required: [] }
    },
    {
      name: "check_availability",
      description:
        "Check what time slots are open for a specific service on a specific date. ALWAYS call this before proposing a time to the customer. Never guess what times are available.",
      input_schema: {
        type: "object",
        properties: {
          service_id: {
            type: "string",
            description: "The ID of the service the customer wants to book"
          },
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format, in the business timezone"
          }
        },
        required: ["service_id", "date"]
      }
    },
    {
      name: "create_booking",
      description:
        "Create a new booking. ONLY call this after the customer has explicitly confirmed the service, date, and time. Do not call this proactively.",
      input_schema: {
        type: "object",
        properties: {
          service_id: { type: "string" },
          start_time: {
            type: "string",
            description: "ISO 8601 datetime in business timezone"
          },
          customer_name: {
            type: "string",
            description: "Customer name as known"
          }
        },
        required: ["service_id", "start_time", "customer_name"]
      }
    },
    {
      name: "cancel_booking",
      description:
        "Cancel an existing booking. Confirm with the customer which booking they want to cancel before calling. Only the customer who created the booking can cancel it.",
      input_schema: {
        type: "object",
        properties: {
          booking_id: { type: "string" }
        },
        required: ["booking_id"]
      }
    },
    {
      name: "reschedule_booking",
      description:
        "Move an existing booking to a new time. Call check_availability first to confirm the new time is open.",
      input_schema: {
        type: "object",
        properties: {
          booking_id: { type: "string" },
          new_start_time: { type: "string", description: "ISO 8601 datetime" }
        },
        required: ["booking_id", "new_start_time"]
      }
    },
    {
      name: "list_my_bookings",
      description: "List the customer's upcoming bookings (and optionally past bookings).",
      input_schema: {
        type: "object",
        properties: {
          include_past: { type: "boolean", description: "Include cancelled / past" }
        },
        required: []
      }
    }
  ];
}

/**
 * @param {string} toolName
 * @param {Record<string, unknown>} input
 * @param {{ business: object, conversation: import("mongoose").Document }} ctx
 */
export async function executeTool(toolName, input, ctx) {
  const bizId = tenantBusinessId(ctx);
  if (!bizId) {
    return { success: false, error: "no_business", userMessage: "Business is not available right now." };
  }

  const phone = ctx.conversation?.customerPhone;

  try {
    switch (toolName) {
      case "get_business_info": {
        const b = ctx.business;
        const data = {
          name: b?.name,
          id: b?.id,
          timezone: b?.timezone,
          services: b?.services || [],
          weeklySchedule: b?.weeklySchedule,
          bookingSettings: b?.bookingSettings,
          businessProfile: b?.businessProfile,
          noShowProtection: b?.noShowProtection
        };
        return { success: true, data };
      }
      case "check_availability": {
        const service_id = String(input?.service_id || "").trim();
        const date = String(input?.date || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return { success: false, error: "bad_date", userMessage: "Please use a date in YYYY-MM-DD format." };
        }
        const tz = ctx.business?.timezone || "America/Toronto";
        const fromIso = fromZonedTime(`${date}T00:00:00`, tz).toISOString();
        const toIso = fromZonedTime(`${date}T23:59:59.999`, tz).toISOString();
        const r = await getAvailability({
          businessId: bizId,
          serviceId: service_id,
          from: fromIso,
          to: toIso,
          timezone: tz
        });
        if (!r.ok) {
          const errStr = String(r.error || "");
          if (errStr.includes("not found") || errStr === "Service not found") {
            return {
              success: false,
              error: "service_not_found",
              userMessage: "I couldn't find that service. Let me check what we offer."
            };
          }
          return {
            success: false,
            error: r.error || "availability_failed",
            userMessage: errStr || "Could not check availability."
          };
        }
        return { success: true, data: { slots: r.slots || [], timezone: r.timezone || tz } };
      }
      case "create_booking": {
        const service_id = String(input?.service_id || "").trim();
        const start_time = String(input?.start_time || "").trim();
        const customer_name = String(input?.customer_name || "").trim();
        if (!service_id || !start_time || !customer_name) {
          return { success: false, error: "validation", userMessage: "Missing booking details." };
        }
        const tz = ctx.business?.timezone || "America/Toronto";
        const result = await createBooking({
          businessId: bizId,
          serviceId: service_id,
          customer: {
            name: customer_name,
            phone
          },
          slot: { start: start_time, timezone: tz },
          source: "whatsapp-ai",
          language: String(ctx.conversation?.language || "en")
            .toLowerCase()
            .slice(0, 5)
        });
        if (!result.ok) {
          const msg =
            result.error === "Selected slot is no longer available"
              ? "That time was just taken. Want to pick another slot?"
              : String(result.error || "Could not complete booking.");
          return { success: false, error: result.error || "create_failed", userMessage: msg };
        }
        return {
          success: true,
          data: {
            booking: result.booking,
            summary: result.summary
          }
        };
      }
      case "cancel_booking": {
        const booking_id = String(input?.booking_id || "").trim();
        const out = await cancelBookingForCustomerChannel({
          bookingId: booking_id,
          businessId: bizId,
          customerPhone: phone
        });
        if (!out.ok) {
          return {
            success: false,
            error: out.error,
            userMessage: out.userMessage || "Could not cancel that booking."
          };
        }
        return { success: true, data: out.data };
      }
      case "reschedule_booking": {
        const booking_id = String(input?.booking_id || "").trim();
        const new_start_time = String(input?.new_start_time || "").trim();
        const rs = await rescheduleBooking({
          bookingId: booking_id,
          customerPhone: phone,
          newSlotStart: new_start_time,
          timezone: ctx.business?.timezone,
          language: String(ctx.conversation?.language || "en")
            .toLowerCase()
            .slice(0, 5)
        });
        if (!rs.ok) {
          return {
            success: false,
            error: rs.error || "reschedule_failed",
            userMessage: rs.message || "Could not reschedule."
          };
        }
        return { success: true, data: { booking: rs.booking, message: rs.message } };
      }
      case "list_my_bookings": {
        const include_past = !!input?.include_past;
        const tz = ctx.business?.timezone || "America/Toronto";
        const today = format(new Date(), "yyyy-MM-dd");
        const fromYmd = include_past ? format(addDays(new Date(), -365), "yyyy-MM-dd") : today;
        const toYmd = format(addDays(new Date(), 365), "yyyy-MM-dd");
        const r = await lookupBookingsByPhone({
          businessId: bizId,
          customerPhone: phone,
          dateFrom: fromYmd,
          dateTo: toYmd,
          includeCancelled: include_past,
          limit: 10
        });
        if (!r.ok) {
          return {
            success: false,
            error: r.error,
            userMessage: "Could not load your bookings."
          };
        }
        return { success: true, data: { bookings: r.bookings || [], count: r.count } };
      }
      default:
        return { success: false, error: "unknown_tool", userMessage: "Unsupported action." };
    }
  } catch (err) {
    console.error("[whatsapp-ai-tools]", toolName, err);
    return {
      success: false,
      error: err?.message || "tool_error",
      userMessage: "Something went wrong. Please try again."
    };
  }
}

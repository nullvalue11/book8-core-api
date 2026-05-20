/**
 * BOO-DEMO-LINE-1A — public Book8 AI demo line helpers.
 */

import { Business } from "../../models/Business.js";
import { businessLookupFilter } from "../../services/provisioningHelpers.js";

export const DEMO_BUSINESS_ID = "biz_book8demo";

export { DEMO_LINE_FIRST_MESSAGE as DEMO_GREETING } from "../prompts/demoLinePrompt.js";

/**
 * @param {object | null | undefined} business
 */
export function isDemoLineBusiness(business) {
  if (!business) return false;
  if (business.category === "demo") return true;
  const bid = business.id || business.businessId;
  if (bid === DEMO_BUSINESS_ID) return true;
  return !!business.metadata?.isDemoLine;
}

/**
 * @param {string | null | undefined} tenantId
 * @param {object} [payload]
 */
export async function isDemoSandboxToolContext(tenantId, payload = {}) {
  if (payload.is_demo === true || payload.sandbox_mode === true) return true;
  if (tenantId === DEMO_BUSINESS_ID) return true;
  if (!tenantId) return false;
  const biz = await Business.findOne(businessLookupFilter(tenantId))
    .select("id businessId category metadata")
    .lean();
  return isDemoLineBusiness(biz);
}

const DEMO_WRITE_TOOLS = new Set([
  "booking.create",
  "create_booking",
  "booking.reschedule",
  "booking.cancel"
]);

export function isDemoBlockedBookingTool(tool) {
  return DEMO_WRITE_TOOLS.has(tool);
}

/**
 * Normalized execute-tool outcome for demo sandbox (no DB writes).
 */
export function simulatedDemoBookingOutcome(tool) {
  const simulatedId = `demo_${Date.now()}`;
  if (tool === "booking.reschedule") {
    return {
      ok: true,
      status: "succeeded",
      result: {
        ok: true,
        simulated: true,
        demo: true,
        message: "Demo line — reschedule is simulated, not persisted.",
        booking: { bookingId: simulatedId, status: "simulated" }
      },
      error: null
    };
  }
  if (tool === "booking.cancel") {
    return {
      ok: true,
      status: "succeeded",
      result: {
        ok: true,
        simulated: true,
        demo: true,
        message: "Demo line — cancellation is simulated, not persisted.",
        bookingId: simulatedId,
        status: "simulated_cancelled"
      },
      error: null
    };
  }
  return {
    ok: true,
    status: "succeeded",
    result: {
      ok: true,
      simulated: true,
      demo: true,
      simulated_booking_id: simulatedId,
      booking: {
        id: simulatedId,
        status: "simulated",
        businessId: DEMO_BUSINESS_ID
      },
      summary:
        "Demo only — no real booking was created. In a real call, this would have been booked in your calendar."
    },
    error: null
  };
}

/**
 * @param {object} params
 */
export function logDemoCallStarted({ businessId, calledNumber, callerNumber }) {
  console.log(
    JSON.stringify({
      event: "demo_call_started",
      business_id: businessId || DEMO_BUSINESS_ID,
      called_number: calledNumber ?? null,
      caller_number: callerNumber ?? null,
      timestamp: new Date().toISOString()
    })
  );
}

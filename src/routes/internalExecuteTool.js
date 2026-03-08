/**
 * Internal execute-tool endpoint for n8n (book8_execute_tool webhook).
 * Dispatches by tool name and returns a normalized shape for ElevenLabs.
 * Same path as tenant.ensure: one webhook → one endpoint → dispatch by tool.
 */

import express from "express";
import { getAvailability } from "../../services/calendarAvailability.js";
import { createBooking } from "../../services/bookingService.js";

const router = express.Router();

/**
 * POST /internal/execute-tool
 * Body: { tool, input, requestId?, executionKey? }
 * Returns: { ok, status, tool, tenantId, requestId, executionKey, result, error }
 */
router.post("/", async (req, res) => {
  try {
    const { tool, input, requestId, executionKey } = req.body;

    if (!tool || typeof tool !== "string") {
      return res.status(400).json({
        ok: false,
        status: "failed",
        tool: tool || "unknown",
        requestId: requestId ?? null,
        executionKey: executionKey ?? null,
        result: null,
        error: { message: "Field 'tool' (string) is required" }
      });
    }

    const payload = typeof input === "object" && input !== null ? input : {};
    const tenantId = payload.businessId ?? null;

    let outcome;
    switch (tool) {
      case "calendar.availability": {
        const { businessId, serviceId, from, to, timezone, durationMinutes } = payload;
        if (!businessId || !from || !to) {
          outcome = {
            ok: false,
            status: "failed",
            result: null,
            error: { message: "businessId, from, and to are required" }
          };
        } else {
          const result = await getAvailability({
            businessId,
            serviceId,
            from,
            to,
            timezone,
            durationMinutes: durationMinutes ?? 60
          });
          if (!result.ok) {
            outcome = {
              ok: false,
              status: "failed",
              result: null,
              error: { message: result.error }
            };
          } else {
            outcome = {
              ok: true,
              status: "succeeded",
              result: {
                businessId: result.businessId,
                serviceId: result.serviceId,
                timezone: result.timezone,
                slots: result.slots
              },
              error: null
            };
          }
        }
        break;
      }
      case "booking.create": {
        const { businessId, serviceId, customer, slot, notes, source } = payload;
        if (!businessId || !customer || !slot) {
          outcome = {
            ok: false,
            status: "failed",
            result: null,
            error: { message: "businessId, customer, and slot are required" }
          };
        } else {
          const result = await createBooking({
            businessId,
            serviceId,
            customer,
            slot,
            notes,
            source
          });
          if (!result.ok) {
            outcome = {
              ok: false,
              status: "failed",
              result: null,
              error: { message: result.error }
            };
          } else {
            outcome = {
              ok: true,
              status: "succeeded",
              result: {
                booking: result.booking,
                summary: result.summary
              },
              error: null
            };
          }
        }
        break;
      }
      default:
        outcome = {
          ok: false,
          status: "failed",
          result: null,
          error: { message: `Unknown tool: ${tool}` }
        };
    }

    return res.json({
      ok: outcome.ok,
      status: outcome.status,
      tool,
      tenantId,
      requestId: requestId ?? null,
      executionKey: executionKey ?? null,
      result: outcome.result,
      error: outcome.error
    });
  } catch (err) {
    console.error("Error in POST /internal/execute-tool:", err);
    const { tool, input, requestId, executionKey } = req.body || {};
    return res.status(500).json({
      ok: false,
      status: "failed",
      tool: tool ?? "unknown",
      tenantId: input?.businessId ?? null,
      requestId: requestId ?? null,
      executionKey: executionKey ?? null,
      result: null,
      error: { message: "Internal server error" }
    });
  }
});

export default router;

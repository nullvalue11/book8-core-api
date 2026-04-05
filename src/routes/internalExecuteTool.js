/**
 * Internal execute-tool endpoint for n8n (book8_execute_tool webhook).
 * Dispatches by tool name and returns a normalized shape for ElevenLabs.
 * Same path as tenant.ensure: one webhook → one endpoint → dispatch by tool.
 */

import express from "express";
import { getAvailability } from "../../services/calendarAvailability.js";
import { createBooking } from "../../services/bookingService.js";
import { ensureTenant } from "../../services/tenantEnsure.js";
import { requireChannel } from "../middleware/planCheck.js";

const router = express.Router();

function requireVoiceForBookingTool(req, res, next) {
  const toolName = req.body?.tool || req.body?.input?.tool;
  if (toolName === "booking.create" || toolName === "create_booking") {
    return requireChannel("voice")(req, res, next);
  }
  next();
}

/**
 * POST /internal/execute-tool
 * Body: { tool, input, requestId?, executionKey? }
 * Returns: { ok, status, tool, tenantId, requestId, executionKey, result, error }
 */
router.post("/", requireVoiceForBookingTool, async (req, res) => {
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
      case "tenant.ensure": {
        const {
          businessId,
          name,
          description,
          category,
          timezone,
          email,
          phoneNumber,
          services,
          plan
        } = payload;
        if (!businessId || !name) {
          outcome = {
            ok: false,
            status: "failed",
            result: null,
            error: { message: "businessId and name are required" }
          };
        } else {
          const result = await ensureTenant({
            businessId,
            name,
            description,
            category,
            timezone,
            email,
            phoneNumber,
            services,
            plan
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
                ok: result.ok,
                businessId: result.businessId,
                existed: result.existed,
                created: result.created,
                ...(result.defaultsEnsured !== undefined && { defaultsEnsured: result.defaultsEnsured })
              },
              error: null
            };
          }
        }
        break;
      }
      case "calendar.availability": {
        const { businessId, serviceId, from, to, timezone, durationMinutes, providerId } = payload;
        if (!businessId || !serviceId || !from || !to) {
          outcome = {
            ok: false,
            status: "failed",
            result: null,
            error: { message: "businessId, serviceId, from, and to are required" }
          };
        } else {
          const result = await getAvailability({
            businessId,
            serviceId,
            from,
            to,
            timezone,
            providerId: providerId || undefined,
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
                providerId: result.providerId ?? null,
                slots: result.slots
              },
              error: null
            };
          }
        }
        break;
      }
      case "booking.create": {
        const {
          businessId,
          serviceId,
          customer: rawCustomer,
          customerName,
          customerPhone,
          customerEmail,
          slot,
          notes,
          source,
          timezone,
          language,
          lang,
          providerId,
          providerName,
          waitlistId,
          recurring
        } = payload;
        let customer = rawCustomer || customerName;
        if (typeof customer === "string") customer = { name: customer };
        if (customer && typeof customer === "object") {
          if (customerPhone != null) customer.phone = customerPhone;
          if (customerEmail != null) customer.email = customerEmail;
        }
        if (!businessId || !serviceId || !customer || !slot) {
          outcome = {
            ok: false,
            status: "failed",
            result: null,
            error: { message: "businessId, serviceId, customer, and slot are required" }
          };
        } else {
          const result = await createBooking({
            businessId,
            serviceId,
            customer,
            slot,
            notes,
            source: source || "voice-agent",
            timezone,
            language: language ?? lang,
            providerId,
            providerName,
            waitlistId,
            recurring
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
      case "ops.getResult": {
        outcome = {
          ok: true,
          status: "succeeded",
          result: payload.result ?? {},
          error: null
        };
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

// src/routes/elevenLabsWebhook.js
import express from "express";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { Schedule } from "../../models/Schedule.js";

const router = express.Router();

/**
 * POST /api/elevenlabs/conversation-init
 *
 * ElevenLabs Conversation Initiation Client Data Webhook.
 * Called when an inbound Twilio call arrives at the ElevenLabs agent.
 *
 * Receives: { caller_id, agent_id, called_number, call_sid }
 * Returns:  { type, dynamic_variables, conversation_config_override }
 *
 * This is what makes the voice agent multi-tenant — one ElevenLabs agent
 * serves all businesses by receiving per-call context from this webhook.
 */
router.post("/conversation-init", async (req, res) => {
  const startTime = Date.now();

  try {
    const { caller_id, agent_id, called_number, call_sid } = req.body;

    // Optional: validate auth header from ElevenLabs
    // The secret is configured in ElevenLabs dashboard → Settings → Webhook → Headers
    const authSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
    if (authSecret) {
      const providedSecret = req.headers["x-book8-webhook-secret"] ||
        req.headers["authorization"]?.replace("Bearer ", "");
      if (!providedSecret || providedSecret !== authSecret) {
        console.warn("[elevenlabs-webhook] Auth failed — invalid or missing secret");
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    console.log("[elevenlabs-webhook] Conversation init request:", {
      caller_id,
      agent_id,
      called_number,
      call_sid
    });

    // 1) Resolve business from the called Twilio number
    let business = null;
    if (called_number) {
      // Normalize the phone number (strip non-digit except leading +)
      const normalized = called_number.replace(/[^\d+]/g, "");
      const e164 = normalized.startsWith("+") ? normalized : `+${normalized}`;

      business = await Business.findOne({
        assignedTwilioNumber: e164
      }).lean();
    }

    // 2) If no business found, return generic defaults
    if (!business) {
      console.warn("[elevenlabs-webhook] No business found for:", called_number);

      return res.json({
        type: "conversation_initiation_client_data",
        dynamic_variables: {
          business_name: "Book8",
          business_id: "unknown",
          services_list: "appointments",
          business_hours: "Monday to Friday, 9 AM to 5 PM",
          timezone: "America/Toronto",
          caller_phone: caller_id || ""
        },
        conversation_config_override: {
          agent: {
            first_message: "Hi, this is the Book8 booking assistant. How can I help you today?"
          }
        }
      });
    }

    const businessId = business.id;

    // 3) Load services for this business
    let services = [];
    try {
      services = await Service.find({
        businessId,
        active: true
      }).lean();
    } catch (err) {
      console.error("[elevenlabs-webhook] Error loading services:", err);
    }

    // Format services as a spoken-friendly list
    let servicesList = "appointments";
    if (services.length > 0) {
      servicesList = services
        .map((s) => {
          const duration = s.durationMinutes ? `${s.durationMinutes}-minute ` : "";
          return `${duration}${s.name}`;
        })
        .join(", ");
    }

    // Also provide services as structured data for tool context
    const servicesDetail = services.map((s) => ({
      serviceId: s.serviceId,
      name: s.name,
      durationMinutes: s.durationMinutes
    }));

    // 4) Load schedule for this business
    let schedule = null;
    try {
      schedule = await Schedule.findOne({ businessId }).lean();
    } catch (err) {
      console.error("[elevenlabs-webhook] Error loading schedule:", err);
    }

    // Format schedule as a spoken-friendly string
    let businessHours = "Monday to Friday, 9 AM to 5 PM";
    if (schedule && schedule.weeklyHours) {
      const days = [];
      const dayNames = {
        monday: "Monday",
        tuesday: "Tuesday",
        wednesday: "Wednesday",
        thursday: "Thursday",
        friday: "Friday",
        saturday: "Saturday",
        sunday: "Sunday"
      };

      for (const [day, blocks] of Object.entries(schedule.weeklyHours)) {
        if (Array.isArray(blocks) && blocks.length > 0) {
          const timeRanges = blocks
            .map((b) => {
              const startFormatted = formatTime(b.start);
              const endFormatted = formatTime(b.end);
              return `${startFormatted} to ${endFormatted}`;
            })
            .join(", ");
          days.push(`${dayNames[day] || day}: ${timeRanges}`);
        }
      }

      if (days.length > 0) {
        businessHours = days.join(". ");
      }
    }

    const timezone = schedule?.timezone || business.timezone || "America/Toronto";
    const businessName = business.name || businessId;

    // 5) Build the greeting
    const greeting = business.greetingOverride ||
      `Hi, thanks for calling ${businessName}. How can I help you today?`;

    // 6) Build today's date for the agent's date awareness
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);

    const elapsed = Date.now() - startTime;
    console.log("[elevenlabs-webhook] Resolved business:", {
      businessId,
      businessName,
      servicesCount: services.length,
      hasSchedule: !!schedule,
      elapsed: `${elapsed}ms`
    });

    // 7) Return the conversation initiation data
    return res.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        business_name: businessName,
        business_id: businessId,
        business_category: business.category || "general",
        services_list: servicesList,
        services_json: JSON.stringify(servicesDetail),
        business_hours: businessHours,
        timezone: timezone,
        today_date: todayIso,
        caller_phone: caller_id || "",
        call_sid: call_sid || ""
      },
      conversation_config_override: {
        agent: {
          first_message: greeting
        }
      }
    });
  } catch (err) {
    console.error("[elevenlabs-webhook] Error:", err);

    // Return generic defaults on error — don't fail the call
    return res.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        business_name: "Book8",
        business_id: "unknown",
        services_list: "appointments",
        business_hours: "Monday to Friday, 9 AM to 5 PM",
        timezone: "America/Toronto",
        caller_phone: req.body?.caller_id || ""
      },
      conversation_config_override: {
        agent: {
          first_message: "Hi, this is the Book8 booking assistant. How can I help you today?"
        }
      }
    });
  }
});

/**
 * Format "09:00" or "17:00" to "9 AM" or "5 PM" for spoken-friendly output.
 */
function formatTime(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return timeStr;
  const [hourStr, minStr] = timeStr.split(":");
  let hour = parseInt(hourStr, 10);
  if (Number.isNaN(hour)) return timeStr;
  const min = parseInt(minStr, 10) || 0;
  const ampm = hour >= 12 ? "PM" : "AM";
  if (hour > 12) hour -= 12;
  if (hour === 0) hour = 12;
  if (min > 0) {
    return `${hour}:${String(min).padStart(2, "0")} ${ampm}`;
  }
  return `${hour} ${ampm}`;
}

export default router;

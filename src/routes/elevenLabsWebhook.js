// src/routes/elevenLabsWebhook.js
import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { Schedule } from "../../models/Schedule.js";
import { Call } from "../models/Call.js";
import { isFeatureAllowed } from "../config/plans.js";
import { safeCompare } from "../middleware/internalAuth.js";
import { clampWindowHours } from "../../services/noShowProtection.js";
import { maskPhone } from "../utils/maskPhone.js";
import {
  buildServicesDetailForElevenLabs,
  buildServicesListForElevenLabs,
  embeddedBusinessServicesAsVoiceList
} from "../utils/elevenlabsServiceVoiceFormat.js";
import { getElevenLabsBusinessLocationVars } from "../utils/formatBusinessAddress.js";

const router = express.Router();

function logElevenLabsInit(businessId, loc) {
  console.log(
    "[elevenlabs-init] businessId=%s city=%s addressLen=%d",
    businessId,
    loc.business_city,
    loc.business_address.length
  );
}

function parseElevenLabsSignatureHeader(header) {
  if (header == null || header === "") return null;
  const parts = String(header).split(",").map((s) => s.trim());
  let t;
  let v0;
  for (const p of parts) {
    if (p.startsWith("t=")) t = p.slice(2);
    else if (p.startsWith("v0=")) v0 = p.slice(3);
  }
  if (!t || !v0) return null;
  return { t, v0 };
}

/**
 * Post-call webhooks: ElevenLabs HMAC (header `elevenlabs-signature: t={unix},v0={hex}`).
 * Signature = HMAC-SHA256(secret, `${t}.${rawBodyString}`). Must use raw bytes (see express.json verify in index.js).
 */
function assertElevenLabsPostCallWebhookAuth(req, res) {
  const secret =
    process.env.ELEVENLABS_WEBHOOK_SECRET || process.env.ELEVENLABS_POSTCALL_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[elevenlabs-webhook] ELEVENLABS_WEBHOOK_SECRET is not configured — rejecting post-call webhook"
    );
    res.status(503).json({ error: "Webhook auth not configured" });
    return false;
  }

  const sigHeader =
    req.headers["elevenlabs-signature"] ||
    req.headers["ElevenLabs-Signature"] ||
    req.headers["x-elevenlabs-signature"];

  if (!sigHeader) {
    console.warn("[elevenlabs-webhook] Auth failed — missing elevenlabs-signature header");
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  const rawBody = req.rawBody;
  if (!Buffer.isBuffer(rawBody)) {
    console.error("[elevenlabs-webhook] Post-call: raw body buffer missing for HMAC verification");
    res.status(500).json({ error: "Internal auth error" });
    return false;
  }

  const parsed = parseElevenLabsSignatureHeader(sigHeader);
  if (!parsed) {
    console.warn("[elevenlabs-webhook] Auth failed — malformed signature header");
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const tsSec = parseInt(parsed.t, 10);
  if (Number.isNaN(tsSec) || Math.abs(nowSec - tsSec) > 30 * 60) {
    console.warn("[elevenlabs-webhook] Auth failed — signature timestamp outside allowed window");
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  const payloadStr = rawBody.toString("utf8");
  const signedContent = `${parsed.t}.${payloadStr}`;
  const expectedHex = createHmac("sha256", secret).update(signedContent, "utf8").digest("hex");

  let ok = false;
  try {
    const a = Buffer.from(parsed.v0, "hex");
    const b = Buffer.from(expectedHex, "hex");
    if (a.length === b.length && a.length > 0) {
      ok = timingSafeEqual(a, b);
    }
  } catch {
    ok = false;
  }

  if (!ok) {
    console.warn("[elevenlabs-webhook] Auth failed — invalid HMAC signature");
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

function languageDynamicVarsFromBusiness(business) {
  if (!business) {
    return { primary_language: "en", multilingual_enabled: true };
  }
  return {
    primary_language: business.primaryLanguage || "en",
    multilingual_enabled: business.multilingualEnabled !== false
  };
}

/** BOO-45A: spoken policy line for voice confirmation (ElevenLabs dynamic variable). */
function noShowPolicyDynamicVar(business) {
  if (!business?.noShowProtection?.enabled) return "";
  const plan = business.plan || "starter";
  if (!isFeatureAllowed(plan, "noShowProtection")) return "";
  const h = clampWindowHours(business.noShowProtection.cancellationWindowHours);
  return `Please note, if you need to cancel, please do so at least ${h} hours in advance to avoid a cancellation fee.`;
}

/** ElevenLabs sends caller_id, called_number, agent_id, call_sid — accept common aliases. */
function parseConversationInitBody(body) {
  const b = body && typeof body === "object" ? body : {};
  return {
    caller_id:
      b.caller_id ??
      b.callerId ??
      b.from_number ??
      b.from ??
      b.phone_number,
    agent_id: b.agent_id ?? b.agentId,
    called_number:
      b.called_number ?? b.calledNumber ?? b.to_number ?? b.to ?? b.called ?? b.dialed_number ?? b.DialedNumber,
    call_sid: b.call_sid ?? b.callSid
  };
}

/** Optional JSON merge for agent-defined dynamic variables (see ElevenLabs docs — all defined vars must be sent). */
function extraDynamicVariableDefaults() {
  const raw = process.env.ELEVENLABS_DYNAMIC_VARIABLE_DEFAULTS;
  if (!raw || typeof raw !== "string") return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    console.warn("[elevenlabs-webhook] ELEVENLABS_DYNAMIC_VARIABLE_DEFAULTS is not valid JSON — ignoring");
    return {};
  }
}

/**
 * Best-effort parse of ElevenLabs Conversational AI 2.0 post-call language fields.
 * @param {object} data - `data` from post-call webhook body
 * @returns {string|null}
 */
function extractDetectedLanguageFromPostCallData(data) {
  if (!data || typeof data !== "object") return null;
  const md = data.metadata || {};
  const an = data.analysis || {};
  let fromTurn = null;
  if (Array.isArray(data.transcript)) {
    const t = data.transcript.find(
      (x) => x && (x.language || x.detected_language)
    );
    if (t) fromTurn = t.language || t.detected_language;
  }
  return (
    data.language ||
    data.detected_language ||
    data.conversation_language ||
    md.language ||
    an.language ||
    fromTurn ||
    null
  );
}

/**
 * POST /api/elevenlabs/conversation-init/:token
 *
 * ElevenLabs Conversation Initiation Client Data Webhook.
 * Called when an inbound Twilio call arrives at the ElevenLabs agent.
 * Auth: path segment must match ELEVENLABS_INIT_TOKEN (ElevenLabs cannot send custom headers here).
 *
 * Receives: { caller_id, agent_id, called_number, call_sid }
 * Returns:  { type, dynamic_variables, conversation_config_override }
 *
 * This is what makes the voice agent multi-tenant — one ElevenLabs agent
 * serves all businesses by receiving per-call context from this webhook.
 */
router.post("/conversation-init/:token", async (req, res) => {
  const startTime = Date.now();

  try {
    const { token } = req.params;
    const expectedToken = process.env.ELEVENLABS_INIT_TOKEN;

    if (!expectedToken) {
      console.error(
        "[elevenlabs-webhook] ELEVENLABS_INIT_TOKEN is not configured — rejecting conversation-init webhook"
      );
      return res.status(503).json({ error: "Webhook auth not configured" });
    }

    if (!safeCompare(token, expectedToken)) {
      console.warn("[ELEVENLABS] Invalid conversation-init token");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const dynamicExtras = extraDynamicVariableDefaults();
    const { caller_id, agent_id, called_number, call_sid } = parseConversationInitBody(req.body);

    console.log("[elevenlabs-webhook] Conversation init request:", {
      caller_id: maskPhone(caller_id),
      agent_id,
      called_number: maskPhone(called_number),
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
      console.warn("[elevenlabs-webhook] No business found for:", maskPhone(called_number));

      const locUnknown = getElevenLabsBusinessLocationVars(null);
      logElevenLabsInit("unknown", locUnknown);

      const todayIso = new Date().toISOString().slice(0, 10);
      return res.json({
        type: "conversation_initiation_client_data",
        dynamic_variables: {
          ...dynamicExtras,
          business_name: "Book8",
          business_id: "unknown",
          business_category: "general",
          services_list: "appointments",
          business_hours: "Monday to Friday, 9 AM to 5 PM",
          timezone: "America/Toronto",
          today_date: todayIso,
          caller_phone: caller_id || "",
          noShowPolicy: "",
          ...locUnknown,
          ...languageDynamicVarsFromBusiness(null)
        },
        conversation_config_override: {
          agent: {
            first_message: "Hi, this is the Book8 booking assistant. How can I help you today?"
          }
        }
      });
    }

    const businessId = business.id;

    // 2b) Gate AI phone agent based on plan
    const plan = business.plan || "starter";
    if (!isFeatureAllowed(plan, "aiPhoneAgent")) {
      console.log("[elevenlabs-webhook] AI agent not available on plan:", plan);
      const businessName = business.name || "this business";
      const tz = business.timezone || "America/Toronto";
      const today = new Date().toLocaleDateString("en-US");
      const locPlan = getElevenLabsBusinessLocationVars(business);
      logElevenLabsInit(businessId, locPlan);
      return res.json({
        type: "conversation_initiation_client_data",
        dynamic_variables: {
          ...dynamicExtras,
          business_name: businessName,
          business_id: businessId,
          services_list: "Not available on current plan",
          services_json: "[]",
          business_hours: "Not available on current plan",
          timezone: tz,
          today_date: today,
          caller_phone: caller_id || "",
          call_sid: call_sid || "",
          business_category: business.category || "",
          greeting: `Thank you for calling ${businessName}. AI phone booking is not available on this plan. Please visit our website to book online or ask the business owner to upgrade to our Growth plan. Goodbye.`,
          noShowPolicy: noShowPolicyDynamicVar(business),
          ...locPlan,
          ...languageDynamicVarsFromBusiness(business)
        }
      });
    }

    // 3) Load services for this business (BOO-75A: include pricing for voice agent)
    let services = [];
    try {
      services = await Service.find({
        businessId,
        active: true
      }).lean();
    } catch (err) {
      console.error("[elevenlabs-webhook] Error loading services:", err);
    }

    if (services.length === 0) {
      services = embeddedBusinessServicesAsVoiceList(business);
    }

    const servicesList = buildServicesListForElevenLabs(services);
    const servicesDetail = buildServicesDetailForElevenLabs(services);

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
      try {
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
              .map((blk) => {
                const startFormatted = formatTime(blk?.start);
                const endFormatted = formatTime(blk?.end);
                return `${startFormatted} to ${endFormatted}`;
              })
              .join(", ");
            days.push(`${dayNames[day] || day}: ${timeRanges}`);
          }
        }

        if (days.length > 0) {
          businessHours = days.join(". ");
        }
      } catch (schedErr) {
        console.error("[elevenlabs-webhook] Error formatting schedule:", schedErr);
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

    const locOk = getElevenLabsBusinessLocationVars(business);
    logElevenLabsInit(businessId, locOk);

    // 7) Return the conversation initiation data
    return res.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        ...dynamicExtras,
        business_name: businessName,
        business_id: businessId,
        business_category: business.category || "general",
        services_list: servicesList,
        services_json: JSON.stringify(servicesDetail),
        business_hours: businessHours,
        timezone: timezone,
        today_date: todayIso,
        caller_phone: caller_id || "",
        call_sid: call_sid || "",
        noShowPolicy: noShowPolicyDynamicVar(business),
        ...locOk,
        ...languageDynamicVarsFromBusiness(business)
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
    const todayIsoErr = new Date().toISOString().slice(0, 10);
    const parsed = parseConversationInitBody(req.body);
    const locErr = getElevenLabsBusinessLocationVars(null);
    logElevenLabsInit("unknown", locErr);
    return res.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        ...extraDynamicVariableDefaults(),
        business_name: "Book8",
        business_id: "unknown",
        business_category: "general",
        services_list: "appointments",
        business_hours: "Monday to Friday, 9 AM to 5 PM",
        timezone: "America/Toronto",
        today_date: todayIsoErr,
        caller_phone: parsed.caller_id || "",
        noShowPolicy: "",
        ...locErr,
        ...languageDynamicVarsFromBusiness(null)
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
 * POST /api/elevenlabs/post-call
 *
 * ElevenLabs Post-Call Webhook.
 * Called after every completed call with transcript, duration, and analysis.
 * This is the primary source of call data for billing and ops.
 *
 * Must return 200 quickly — ElevenLabs auto-disables webhooks after 10
 * consecutive failures.
 */
router.post("/post-call", async (req, res) => {
  if (!assertElevenLabsPostCallWebhookAuth(req, res)) return;

  const startTime = Date.now();

  try {
    const { type, event_timestamp, data } = req.body;

    if (!type || !data) {
      console.warn("[elevenlabs-post-call] Missing type or data in webhook payload");
      return res.status(200).json({ status: "ignored", reason: "missing type or data" });
    }

    console.log("[elevenlabs-post-call] Received:", {
      type,
      conversationId: data.conversation_id,
      agentId: data.agent_id,
      eventTimestamp: event_timestamp
    });

    if (type === "post_call_transcription") {
      await handleTranscription(data);
    } else if (type === "call_initiation_failure") {
      await handleInitiationFailure(data);
    } else if (type === "post_call_audio") {
      console.log("[elevenlabs-post-call] Ignoring audio webhook for:", data.conversation_id);
    } else {
      console.log("[elevenlabs-post-call] Unknown webhook type:", type);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[elevenlabs-post-call] Processed in ${elapsed}ms`);

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("[elevenlabs-post-call] Error processing webhook:", err);
    return res.status(200).json({ status: "error", message: "Processing failed but acknowledged" });
  }
});

/**
 * Handle post_call_transcription webhook.
 * Extracts call data and upserts into the Call collection.
 */
async function handleTranscription(data) {
  const detectedLanguage = extractDetectedLanguageFromPostCallData(data);
  const language = detectedLanguage || "en";
  console.log("[elevenlabs-post-call] Detected language:", detectedLanguage);
  console.log("[elevenlabs-post-call] Full data keys:", Object.keys(data || {}));

  const {
    agent_id,
    conversation_id,
    transcript,
    metadata,
    analysis,
    conversation_initiation_client_data
  } = data;

  const dynamicVars = conversation_initiation_client_data?.dynamic_variables || {};
  const businessId = dynamicVars.business_id || "unknown";
  const callerPhone = dynamicVars.caller_phone || "";
  const callSid = dynamicVars.call_sid || "";

  const callDurationSecs = metadata?.call_duration_secs || 0;
  const startTimeUnix = metadata?.start_time_unix_secs || 0;
  const cost = metadata?.cost || 0;
  const terminationReason = metadata?.termination_reason || "";

  const callSuccessful = analysis?.call_successful || "unknown";
  const transcriptSummary = analysis?.transcript_summary || "";

  const formattedTranscript = Array.isArray(transcript)
    ? transcript.map((turn, index) => ({
        turnId: `${conversation_id}:${turn.role}:${index}`,
        role: turn.role === "agent" ? "agent" : "caller",
        text: turn.message || "",
        timestamp: startTimeUnix
          ? new Date((startTimeUnix + (turn.time_in_call_secs || 0)) * 1000)
          : new Date()
      }))
    : [];

  const agentChars = formattedTranscript
    .filter(t => t.role === "agent")
    .reduce((sum, t) => sum + (t.text?.length || 0), 0);

  console.log("[elevenlabs-post-call] Transcription data:", {
    businessId,
    conversationId: conversation_id,
    callSid: callSid || "(no callSid)",
    durationSecs: callDurationSecs,
    transcriptTurns: formattedTranscript.length,
    callSuccessful,
    agentTtsChars: agentChars
  });

  const callIdentifier = callSid || `el_${conversation_id}`;

  try {
    const update = {
      $set: {
        businessId,
        status: "completed",
        durationSeconds: callDurationSecs,
        endTime: startTimeUnix
          ? new Date((startTimeUnix + callDurationSecs) * 1000)
          : new Date(),
        transcript: formattedTranscript,
        language,
        languageDetected: !!detectedLanguage,
        elevenLabs: {
          conversationId: conversation_id,
          agentId: agent_id,
          callSuccessful,
          transcriptSummary,
          cost,
          terminationReason
        }
      },
      $setOnInsert: {
        callSid: callIdentifier,
        fromNumber: callerPhone,
        startTime: startTimeUnix ? new Date(startTimeUnix * 1000) : new Date()
      },
      $inc: {
        "usage.ttsCharacters": agentChars
      }
    };

    await Call.findOneAndUpdate(
      { callSid: callIdentifier },
      update,
      { upsert: true, new: true }
    );

    console.log("[elevenlabs-post-call] Call record saved:", callIdentifier);
  } catch (err) {
    console.error("[elevenlabs-post-call] Error saving call record:", err);
  }
}

/**
 * Handle call_initiation_failure webhook.
 * Logs failed call attempts for monitoring.
 */
async function handleInitiationFailure(data) {
  const {
    agent_id,
    conversation_id,
    failure_reason,
    metadata
  } = data;

  const providerType = metadata?.type || "unknown";
  const providerBody = metadata?.body || {};

  const callSid = providerBody.CallSid || providerBody.call_sid || `el_fail_${conversation_id}`;
  const callerNumber = providerBody.From || providerBody.from_number || "";
  const calledNumber = providerBody.To || providerBody.to_number || "";

  console.error("[elevenlabs-post-call] Call initiation failed:", {
    conversationId: conversation_id,
    agentId: agent_id,
    failureReason: failure_reason,
    providerType,
    callSid,
    from: maskPhone(callerNumber),
    to: maskPhone(calledNumber)
  });

  try {
    await Call.findOneAndUpdate(
      { callSid },
      {
        $set: {
          status: "failed",
          endTime: new Date(),
          elevenLabs: {
            conversationId: conversation_id,
            agentId: agent_id,
            failureReason: failure_reason,
            providerType
          }
        },
        $setOnInsert: {
          callSid,
          fromNumber: callerNumber,
          toNumber: calledNumber,
          startTime: new Date(),
          businessId: "unknown"
        }
      },
      { upsert: true, new: true }
    );

    console.log("[elevenlabs-post-call] Failed call record saved:", callSid);
  } catch (err) {
    console.error("[elevenlabs-post-call] Error saving failed call record:", err);
  }
}

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

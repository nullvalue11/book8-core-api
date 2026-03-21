/**
 * Configure Twilio + ElevenLabs after assigning a pool number or purchasing new pool stock.
 * Voice must hit ElevenLabs; SMS hits core-api (shared inbound handler).
 */
import twilio from "twilio";

const ELEVENLABS_VOICE_URL =
  process.env.ELEVENLABS_TWILIO_VOICE_URL || "https://api.us.elevenlabs.io/twilio/inbound_call";
const ELEVENLABS_STATUS_CALLBACK_URL =
  process.env.ELEVENLABS_TWILIO_STATUS_URL || "https://api.us.elevenlabs.io/twilio/status-callback";

/** Import Twilio number — official API: POST /v1/convai/phone-numbers (not …/create). */
const _elevenLabsPhoneBase =
  process.env.ELEVENLABS_CONVAI_PHONE_NUMBERS_URL || process.env.ELEVENLABS_PHONE_CREATE_URL;
const ELEVENLABS_CONVAI_PHONE_NUMBERS_URL = (
  _elevenLabsPhoneBase
    ? _elevenLabsPhoneBase.replace(/\/create\/?$/i, "")
    : "https://api.elevenlabs.io/v1/convai/phone-numbers"
).replace(/\/$/, "");

/** Public base URL for this API (no trailing slash). Used for Twilio SMS webhook. */
export function getCoreApiPublicBaseUrl() {
  const fromEnv = process.env.BOOK8_CORE_API_URL || process.env.PUBLIC_CORE_API_URL;
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  return "https://book8-core-api.onrender.com";
}

export function getSmsWebhookUrl() {
  return `${getCoreApiPublicBaseUrl()}/api/twilio/inbound-sms`;
}

/**
 * Full webhook setup for a number assigned to a business (voice → ElevenLabs, SMS → core-api).
 * @param {{ twilioSid?: string, phoneNumber?: string }} params — need at least one
 * @returns {Promise<boolean>}
 */
export async function configureTwilioWebhooksForNumber({ twilioSid, phoneNumber } = {}) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.warn("[provisioning] Twilio credentials missing — skipping webhook configuration");
    return false;
  }

  const client = twilio(accountSid, authToken);
  let sid = twilioSid;

  if (!sid && phoneNumber) {
    try {
      const numbers = await client.incomingPhoneNumbers.list({ phoneNumber });
      if (!numbers.length) {
        console.error("[provisioning] Could not find Twilio number:", phoneNumber);
        return false;
      }
      sid = numbers[0].sid;
    } catch (err) {
      console.error("[provisioning] Twilio lookup failed:", err.message);
      return false;
    }
  }

  if (!sid) {
    console.error("[provisioning] No Twilio SID or phone number for webhook configuration");
    return false;
  }

  const smsUrl = getSmsWebhookUrl();

  try {
    await client.incomingPhoneNumbers(sid).update({
      voiceUrl: ELEVENLABS_VOICE_URL,
      voiceMethod: "POST",
      statusCallback: ELEVENLABS_STATUS_CALLBACK_URL,
      statusCallbackMethod: "POST",
      smsUrl,
      smsMethod: "POST"
    });
    console.log("[provisioning] Twilio webhooks configured (voice + SMS + status) for:", phoneNumber || sid);
    return true;
  } catch (err) {
    console.error("[provisioning] Failed to configure Twilio webhooks:", err.message);
    return false;
  }
}

/**
 * Pre-configure voice webhooks for newly purchased pool numbers (SMS set on assignment).
 * @param {string} twilioSid
 * @returns {Promise<boolean>}
 */
export async function configureTwilioVoiceForPoolNumber(twilioSid) {
  if (!twilioSid) return false;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    console.warn("[replenish] Twilio credentials missing — skipping voice webhook");
    return false;
  }

  try {
    const client = twilio(accountSid, authToken);
    await client.incomingPhoneNumbers(twilioSid).update({
      voiceUrl: ELEVENLABS_VOICE_URL,
      voiceMethod: "POST",
      statusCallback: ELEVENLABS_STATUS_CALLBACK_URL,
      statusCallbackMethod: "POST"
    });
    console.log("[replenish] Voice + status webhooks set for pool number SID:", twilioSid);
    return true;
  } catch (err) {
    console.error("[replenish] Failed to set voice webhooks:", err.message);
    return false;
  }
}

function elevenLabsErrorLooksLikeAlreadyRegistered(status, errorData) {
  if (status === 409) return true;
  const raw = typeof errorData === "string" ? errorData : JSON.stringify(errorData || {}).toLowerCase();
  return raw.includes("already") || raw.includes("exist") || raw.includes("duplicate");
}

function redactElevenLabsRequestBody(body) {
  if (!body || typeof body !== "object") return body;
  const copy = { ...body };
  if (typeof copy.token === "string") copy.token = "[REDACTED]";
  return copy;
}

async function parseFetchJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * List ConvAI phone numbers (Twilio + SIP). See OpenAPI GET /v1/convai/phone-numbers.
 */
async function listConvaiPhoneNumbers(apiKey) {
  const res = await fetch(ELEVENLABS_CONVAI_PHONE_NUMBERS_URL, {
    method: "GET",
    headers: { "xi-api-key": apiKey }
  });
  const data = await parseFetchJson(res);
  if (!res.ok) {
    console.warn("[provisioning] ElevenLabs list phone numbers failed:", res.status, data);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

async function findConvaiPhoneNumberId(apiKey, phoneNumber) {
  const list = await listConvaiPhoneNumbers(apiKey);
  const hit = list.find((x) => x && x.phone_number === phoneNumber);
  return hit?.phone_number_id ?? null;
}

/**
 * Assign agent to an imported number. PATCH /v1/convai/phone-numbers/{phone_number_id}
 */
async function assignConvaiAgentToPhoneNumber({ apiKey, phoneNumberId, agentId }) {
  const base = ELEVENLABS_CONVAI_PHONE_NUMBERS_URL.replace(/\/$/, "");
  const url = `${base}/${encodeURIComponent(phoneNumberId)}`;
  const patchBody = { agent_id: agentId };
  console.log("[provisioning] ElevenLabs request:", {
    url,
    method: "PATCH",
    body: JSON.stringify(patchBody)
  });

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(patchBody)
  });
  const data = await parseFetchJson(res);
  if (!res.ok) {
    console.error("[provisioning] ElevenLabs assign agent failed:", res.status, data);
    return false;
  }
  console.log("[provisioning] ElevenLabs agent assigned to phone:", phoneNumberId, data);
  return true;
}

/**
 * Register / import a Twilio number in ElevenLabs, then assign the Book8 agent.
 * OpenAPI: POST /v1/convai/phone-numbers with CreateTwilioPhoneNumberRequest
 * (required: phone_number, label, sid, token; provider must be "twilio").
 *
 * @param {string} phoneNumber — E.164 e.g. +15064048251
 * @returns {Promise<boolean>}
 */
export async function registerNumberInElevenLabs(phoneNumber) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!apiKey || !agentId) {
    console.warn(
      "[provisioning] ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID not set — skipping ElevenLabs registration"
    );
    console.warn(
      `[provisioning] ⚠️ MANUAL STEP: Add ${phoneNumber} to ElevenLabs agent in dashboard`
    );
    return false;
  }

  if (!accountSid || !authToken) {
    console.warn("[provisioning] Twilio credentials missing — cannot register number in ElevenLabs");
    return false;
  }

  const importUrl = ELEVENLABS_CONVAI_PHONE_NUMBERS_URL.replace(/\/$/, "");
  /** CreateTwilioPhoneNumberRequest (ElevenLabs OpenAPI) */
  const requestBody = {
    phone_number: phoneNumber,
    label: `Book8 - ${phoneNumber}`,
    provider: "twilio",
    sid: accountSid,
    token: authToken
  };

  console.log("[provisioning] ElevenLabs request:", {
    url: importUrl,
    method: "POST",
    body: JSON.stringify(redactElevenLabsRequestBody(requestBody))
  });

  try {
    let response = await fetch(importUrl, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    let body = await parseFetchJson(response);

    if (!response.ok) {
      const detailStr = JSON.stringify(body || {}).toLowerCase();
      const maybeDuplicate =
        response.status === 409 ||
        elevenLabsErrorLooksLikeAlreadyRegistered(response.status, body) ||
        (response.status === 422 && (detailStr.includes("already") || detailStr.includes("exist")));

      if (maybeDuplicate) {
        const existingId = await findConvaiPhoneNumberId(apiKey, phoneNumber);
        if (existingId) {
          console.log(
            "[provisioning] Number already in ElevenLabs — assigning agent:",
            phoneNumber,
            existingId
          );
          const assigned = await assignConvaiAgentToPhoneNumber({
            apiKey,
            phoneNumberId: existingId,
            agentId
          });
          if (!assigned) {
            console.warn(
              `[provisioning] ⚠️ MANUAL STEP: Assign agent to ${phoneNumber} in ElevenLabs dashboard`
            );
          }
          return assigned;
        }
      }

      if (response.status === 404 || response.status === 405) {
        console.warn("[provisioning] ElevenLabs import URL rejected — check ELEVENLABS_CONVAI_PHONE_NUMBERS_URL");
      }

      console.error("[provisioning] ElevenLabs import failed:", response.status, body);
      console.warn(
        `[provisioning] ⚠️ MANUAL STEP: Add ${phoneNumber} to ElevenLabs agent in dashboard`
      );
      return false;
    }

    const phoneNumberId = body?.phone_number_id;
    if (!phoneNumberId) {
      console.error("[provisioning] ElevenLabs import OK but missing phone_number_id:", body);
      return false;
    }

    console.log("[provisioning] ElevenLabs imported phone:", phoneNumber, phoneNumberId);
    const assigned = await assignConvaiAgentToPhoneNumber({ apiKey, phoneNumberId, agentId });
    if (!assigned) {
      console.warn(
        `[provisioning] ⚠️ MANUAL STEP: Assign agent to ${phoneNumber} (${phoneNumberId}) in ElevenLabs dashboard`
      );
    }
    return assigned;
  } catch (err) {
    console.error("[provisioning] ElevenLabs registration error:", err.message);
    console.warn(
      `[provisioning] ⚠️ MANUAL STEP: Add ${phoneNumber} to ElevenLabs agent in dashboard`
    );
    return false;
  }
}

export function logProvisioningNumberSetup({ phoneNumber, webhooksConfigured, elevenLabsRegistered }) {
  console.log("[provisioning] Number setup complete:", {
    number: phoneNumber,
    webhooksConfigured,
    elevenLabsRegistered,
    fullyAutomatic: !!(webhooksConfigured && elevenLabsRegistered)
  });
}

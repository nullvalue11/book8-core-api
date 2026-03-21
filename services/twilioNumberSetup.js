/**
 * Configure Twilio + ElevenLabs after assigning a pool number or purchasing new pool stock.
 * Voice must hit ElevenLabs; SMS hits core-api (shared inbound handler).
 */
import twilio from "twilio";

const ELEVENLABS_VOICE_URL =
  process.env.ELEVENLABS_TWILIO_VOICE_URL || "https://api.us.elevenlabs.io/twilio/inbound_call";
const ELEVENLABS_STATUS_CALLBACK_URL =
  process.env.ELEVENLABS_TWILIO_STATUS_URL || "https://api.us.elevenlabs.io/twilio/status-callback";

const ELEVENLABS_PHONE_CREATE_URL =
  process.env.ELEVENLABS_PHONE_CREATE_URL || "https://api.elevenlabs.io/v1/convai/phone-numbers/create";

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

/**
 * Register / link a Twilio number with ElevenLabs ConvAI agent.
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

  try {
    const response = await fetch(ELEVENLABS_PHONE_CREATE_URL, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone_number: phoneNumber,
        provider: "twilio",
        label: `Book8 - ${phoneNumber}`,
        agent_id: agentId,
        twilio_account_sid: accountSid,
        twilio_auth_token: authToken
      })
    });

    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      if (elevenLabsErrorLooksLikeAlreadyRegistered(response.status, body)) {
        console.log("[provisioning] Number already registered in ElevenLabs — continuing:", phoneNumber);
        return true;
      }
      console.error("[provisioning] ElevenLabs registration failed:", response.status, body);
      console.warn(
        `[provisioning] ⚠️ MANUAL STEP: Add ${phoneNumber} to ElevenLabs agent in dashboard`
      );
      return false;
    }

    console.log("[provisioning] Number registered in ElevenLabs:", phoneNumber, body);
    return true;
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

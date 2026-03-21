/**
 * One-time / ops: set ElevenLabs voice + core-api SMS webhooks on a Twilio number.
 *
 * Usage:
 *   node scripts/configureTwilioWebhooks.js +15064048251
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 * Optional: BOOK8_CORE_API_URL (defaults to Render URL in twilioNumberSetup)
 */
import "dotenv/config";
import { configureTwilioWebhooksForNumber } from "../services/twilioNumberSetup.js";

const phone = process.argv[2];
if (!phone) {
  console.error("Usage: node scripts/configureTwilioWebhooks.js +1XXXXXXXXXX");
  process.exit(1);
}

const ok = await configureTwilioWebhooksForNumber({ phoneNumber: phone });
process.exit(ok ? 0 : 1);

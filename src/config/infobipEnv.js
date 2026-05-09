/**
 * BOO-INFOBIP-INTEGRATE-1A — validate Infobip env combinations at startup.
 * If neither INFOBIP_API_KEY nor INFOBIP_BASE_URL is set, Infobip is disabled (Twilio-only).
 * Partial configuration is fatal to avoid silent misroutes.
 */
export function validateInfobipPartialConfig() {
  const key = process.env.INFOBIP_API_KEY?.trim();
  const base = process.env.INFOBIP_BASE_URL?.trim();

  if (!key && !base) {
    return;
  }

  if (key && !base) {
    console.error("[infobip] INFOBIP_API_KEY is set but INFOBIP_BASE_URL is missing — exiting");
    process.exit(1);
  }

  if (base && !key) {
    console.error("[infobip] INFOBIP_BASE_URL is set but INFOBIP_API_KEY is missing — exiting");
    process.exit(1);
  }

  if (!/^https:\/\//i.test(base)) {
    console.error("[infobip] INFOBIP_BASE_URL must be an https URL — exiting");
    process.exit(1);
  }
}

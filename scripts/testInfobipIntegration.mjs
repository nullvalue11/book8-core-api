#!/usr/bin/env node
/**
 * BOO-INFOBIP-INTEGRATE-1A — smoke Infobip WhatsApp API (real network).
 *
 * Usage:
 *   node scripts/testInfobipIntegration.mjs --to=+971501234567
 *   $env:INFOBIP_TEST_TO="+971501234567"; node scripts/testInfobipIntegration.mjs
 *
 * Requires: INFOBIP_API_KEY, INFOBIP_BASE_URL, INFOBIP_TEST_SENDER
 * Optional: INFOBIP_TEST_TEMPLATE (default booking_confirmation)
 */

import "dotenv/config";

import { listSenders, sendWhatsAppTemplate } from "../services/infobip/infobipClient.js";

function argTo(name) {
  const pre = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : "";
}

const to =
  argTo("to") ||
  process.env.INFOBIP_TEST_TO ||
  "";

async function main() {
  if (!process.env.INFOBIP_API_KEY || !process.env.INFOBIP_BASE_URL) {
    console.error("Set INFOBIP_API_KEY and INFOBIP_BASE_URL");
    process.exit(1);
  }

  const senders = await listSenders();
  console.log("[infobip-test] senders:", JSON.stringify(senders, null, 2).slice(0, 2000));

  if (!to) {
    console.log("[infobip-test] No --to= or INFOBIP_TEST_TO — skipping template send");
    process.exit(0);
  }

  const from = process.env.INFOBIP_TEST_SENDER?.trim();
  if (!from) {
    console.error("INFOBIP_TEST_SENDER is required to send a test template");
    process.exit(1);
  }

  const template = process.env.INFOBIP_TEST_TEMPLATE?.trim() || "booking_confirmation";

  const data = await sendWhatsAppTemplate({
    from,
    to,
    templateName: template,
    languageCode: process.env.INFOBIP_TEST_LANG?.trim() || "en",
    placeholders: (process.env.INFOBIP_TEST_PLACEHOLDERS || "Test User,Book8 Demo,Service A,Jan 1,10:00 AM")
      .split(",")
      .map((s) => s.trim())
  });

  console.log("[infobip-test] template send response:", JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("[infobip-test] failed:", err.message);
  process.exit(1);
});

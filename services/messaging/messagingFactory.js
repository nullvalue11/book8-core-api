import { TwilioProvider } from "./TwilioProvider.js";
import { InfobipProvider } from "./InfobipProvider.js";
import { resolveMessagingBackend } from "./bspRouting.js";

const twilio = new TwilioProvider();
const infobip = new InfobipProvider();

/**
 * @param {object} business
 * @returns {import("./MessagingProvider.js").MessagingProvider}
 */
export function getMessagingProvider(business) {
  const backend = resolveMessagingBackend(business || {});
  return backend === "infobip" ? infobip : twilio;
}

export { TwilioProvider, InfobipProvider, resolveMessagingBackend };

/**
 * Twilio number pool: assign, release, and manage numbers.
 */
import { TwilioNumber } from "../models/TwilioNumber.js";
import { Business } from "../models/Business.js";
import twilio from "twilio";

/**
 * Release a number from a business back to the pool. Future-ready; not wired to any route yet.
 * @param {string} businessId
 * @returns {Promise<import('../models/TwilioNumber.js').TwilioNumber | null>}
 */
export async function releaseNumber(businessId) {
  const number = await TwilioNumber.findOneAndUpdate(
    { assignedToBusinessId: businessId, status: "assigned" },
    {
      status: "available",
      assignedToBusinessId: null,
      assignedAt: null,
      updatedAt: new Date()
    },
    { new: true }
  );

  if (number) {
    await Business.findOneAndUpdate(
      { id: businessId },
      { $unset: { assignedTwilioNumber: 1 }, $set: { numberSetupMethod: "pending" } }
    );
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      try {
        const twilioClient = twilio(accountSid, authToken);
        await twilioClient.incomingPhoneNumbers(number.twilioSid).update({
          smsUrl: "",
          smsMethod: "POST"
        });
      } catch (err) {
        console.error("[twilioPool] Failed to clear SMS webhook:", err.message);
      }
    }
    console.log("[twilioPool] Released", number.phoneNumber, "from", businessId);
  }
  return number;
}

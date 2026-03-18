/**
 * Seed TwilioNumber collection from Twilio account.
 * Run: node scripts/seedTwilioNumbers.js
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, MONGODB_URI
 */
import "dotenv/config";
import mongoose from "mongoose";
import twilio from "twilio";
import { TwilioNumber } from "../models/TwilioNumber.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/book8_core";
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const SPECIAL_NUMBER = "+16477882883";
const SPECIAL_BUSINESS_ID = "biz_mmpsyemadcrxuc";

async function main() {
  if (!accountSid || !authToken) {
    console.error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log("[seedTwilioNumbers] Connected to MongoDB");

  const client = twilio(accountSid, authToken);
  const numbers = await client.incomingPhoneNumbers.list();

  let processed = 0;
  let assigned = 0;
  let available = 0;

  for (const number of numbers) {
    const isSpecial = number.phoneNumber === SPECIAL_NUMBER;
    const status = isSpecial ? "assigned" : "available";
    const assignedToBusinessId = isSpecial ? SPECIAL_BUSINESS_ID : null;
    const assignedAt = isSpecial ? new Date() : null;
    const areaCode = number.phoneNumber.slice(2, 5);

    await TwilioNumber.findOneAndUpdate(
      { phoneNumber: number.phoneNumber },
      {
        $set: {
          phoneNumber: number.phoneNumber,
          twilioSid: number.sid,
          areaCode,
          capabilities: {
            voice: number.capabilities?.voice ?? true,
            sms: number.capabilities?.sms ?? true
          },
          status,
          assignedToBusinessId,
          assignedAt,
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

    if (isSpecial) {
      console.log("[seedTwilioNumbers]", number.phoneNumber, "-> assigned to", SPECIAL_BUSINESS_ID);
      assigned++;
    } else {
      console.log("[seedTwilioNumbers]", number.phoneNumber, "-> available");
      available++;
    }
    processed++;
  }

  console.log("[seedTwilioNumbers] Done. Processed:", processed, "assigned:", assigned, "available:", available);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("[seedTwilioNumbers] Error:", err);
  process.exit(1);
});

/**
 * BOO-WIZARD-COUNTRY-BRANCH-1A — one-time backfill of availableChannels (+ twilioNumberStatus)
 * for businesses created before the wizard country branch.
 *
 * Idempotent: only updates documents where availableChannels is missing.
 *
 * Usage: node scripts/migrations/backfillAvailableChannels.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Business } from "../../models/Business.js";
import { resolveCountryIsoForBusiness } from "../../src/utils/businessCountry.js";
import { getAvailableChannels } from "../../src/config/voiceCountries.js";

const MONGODB_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/book8";

async function main() {
  await mongoose.connect(MONGODB_URI);

  const filter = {
    $or: [{ availableChannels: { $exists: false } }, { availableChannels: null }]
  };

  const cursor = Business.find(filter).cursor();
  let updated = 0;

  for await (const doc of cursor) {
    const iso = resolveCountryIsoForBusiness(doc.country);
    const channels = getAvailableChannels(iso);

    let twilioNumberStatus = doc.twilioNumberStatus;
    if (!twilioNumberStatus) {
      if (doc.assignedTwilioNumber) twilioNumberStatus = "provisioned";
      else if (!channels.voice) twilioNumberStatus = "skipped_voice_blocked";
      else twilioNumberStatus = "pending";
    }

    await Business.updateOne(
      { _id: doc._id },
      { $set: { availableChannels: channels, twilioNumberStatus } }
    );
    updated += 1;
  }

  console.log("[backfillAvailableChannels] updated:", updated);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[backfillAvailableChannels]", err);
  process.exit(1);
});

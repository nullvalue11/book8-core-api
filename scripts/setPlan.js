/**
 * Set plan for a business using core-api's Business model.
 * Run: MONGODB_URI=<uri> node scripts/setPlan.js
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Business } from "../models/Business.js";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

await mongoose.connect(uri);

// Business model uses "id" as the business identifier
let result = await Business.findOneAndUpdate(
  { id: "biz_mmpsyemadcrxuc" },
  { $set: { plan: "growth" } },
  { new: true }
);

if (result) {
  console.log("Updated plan to:", result.plan);
} else {
  result = await Business.findOneAndUpdate(
    { businessId: "biz_mmpsyemadcrxuc" },
    { $set: { plan: "growth" } },
    { new: true }
  );
  console.log("Updated (by businessId) plan to:", result?.plan || "NOT FOUND");
}

await mongoose.disconnect();
process.exit(result ? 0 : 1);

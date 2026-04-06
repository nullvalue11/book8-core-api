/**
 * BOO-76A — One-off: align car wash franchise service rows + embedded arrays for two production IDs.
 * Run: node scripts/boo76SeedCarWashServices.mjs
 * Requires MONGODB_URI (env or .env).
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Service } from "../models/Service.js";
import { refreshBusinessEmbeddedServices } from "../services/franchiseServiceSync.js";

const BIZ_WITH = "biz_mnmmr26lnj5ug5";
const BIZ_NEED = "biz_mnmqsh4xnfygae";

const rows = [
  {
    businessId: BIZ_WITH,
    serviceId: "full-wash-interior-only",
    name: "Full Wash - Interior Only",
    durationMinutes: 60,
    price: 50,
    active: true
  },
  {
    businessId: BIZ_WITH,
    serviceId: "full-wash-exterior-only",
    name: "Full Wash - Exterior Only",
    durationMinutes: 60,
    price: 50,
    active: true
  },
  {
    businessId: BIZ_WITH,
    serviceId: "full-wash-interior-exterior",
    name: "Full Wash - Interior & Exterior",
    durationMinutes: 90,
    price: 100,
    active: true
  },
  {
    businessId: BIZ_NEED,
    serviceId: "full-wash-interior-only",
    name: "Full Wash - Interior Only",
    durationMinutes: 60,
    price: 50,
    active: true
  },
  {
    businessId: BIZ_NEED,
    serviceId: "full-wash-exterior-only",
    name: "Full Wash - Exterior Only",
    durationMinutes: 60,
    price: 50,
    active: true
  },
  {
    businessId: BIZ_NEED,
    serviceId: "full-wash-interior-exterior",
    name: "Full Wash - Interior & Exterior",
    durationMinutes: 90,
    price: 100,
    active: true
  }
];

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set. Aborting.");
  process.exit(1);
}

await mongoose.connect(uri);
try {
  for (const r of rows) {
    await Service.findOneAndUpdate(
      { businessId: r.businessId, serviceId: r.serviceId },
      {
        $set: {
          name: r.name,
          durationMinutes: r.durationMinutes,
          price: r.price,
          currency: "USD",
          active: r.active
        },
        $setOnInsert: {
          businessId: r.businessId,
          serviceId: r.serviceId
        }
      },
      { upsert: true }
    );
    console.log(`upserted ${r.businessId} ${r.serviceId}`);
  }
  await refreshBusinessEmbeddedServices(BIZ_WITH);
  await refreshBusinessEmbeddedServices(BIZ_NEED);
  console.log("refreshed embedded services on both businesses");
} finally {
  await mongoose.disconnect();
}

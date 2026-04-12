/**
 * BOO-102A — Monthly insights recap email (cron on 1st, idempotent via notifications.sent).
 */
import { Business } from "../models/Business.js";
import {
  computeBusinessInsights,
  previousMonthRange
} from "./insights/computeBusinessInsights.js";
import { notificationAlreadySent } from "./trialNotifications.js";
import { sendMonthlyRecapEmail } from "./emailService.js";

function ownerFirstName(business) {
  const raw = business.ownerEmail || business.email || business.businessProfile?.email || "";
  const local = String(raw).split("@")[0] || "";
  const part = local.split(/[._-]/)[0] || "";
  if (part) return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  return String(business.name || "there").split(/\s+/)[0] || "there";
}

/**
 * @param {{ now?: Date, forceFire?: boolean }} opts
 * @returns {Promise<{ processed: number, sent: number, skipped?: string }>}
 */
export async function runMonthlyInsightsRecap({ now = new Date(), forceFire = false } = {}) {
  if (now.getUTCDate() !== 1 && !forceFire) {
    console.log("[monthly-insights-recap] not 1st of month (UTC), skipping");
    return { processed: 0, sent: 0, skipped: "not_first_of_month" };
  }

  const lastMonth = previousMonthRange(now);
  const monthBefore = previousMonthRange(new Date(lastMonth.start.getTime() - 86400000));

  const businesses = await Business.find({
    "trial.status": { $in: ["active", "grace", "subscribed"] }
  }).lean();

  let sent = 0;
  for (const business of businesses) {
    if (business.notifications?.preferences?.monthlyRecapEmail === false) {
      continue;
    }

    const dedupKey = lastMonth.dedupKey;
    if (notificationAlreadySent(business, dedupKey)) {
      continue;
    }

    const bid = business.id || business.businessId;
    if (!bid) continue;

    const [current, prior] = await Promise.all([
      computeBusinessInsights(bid, lastMonth, business),
      computeBusinessInsights(bid, monthBefore, business)
    ]);

    if (current.bookingsCount === 0 && current.callsCount === 0) {
      continue;
    }

    const result = await sendMonthlyRecapEmail(business, {
      firstName: ownerFirstName(business),
      businessName: business.name || bid,
      monthLabel: lastMonth.label,
      current,
      prior
    });

    if (result?.ok) {
      await Business.updateOne(
        { _id: business._id },
        {
          $push: {
            "notifications.sent": { type: dedupKey, sentAt: new Date(), channel: "email" }
          }
        }
      );
      sent++;
      console.log(`[monthly-insights-recap] sent ${dedupKey} business=${bid}`);
    }
  }

  return { processed: businesses.length, sent };
}

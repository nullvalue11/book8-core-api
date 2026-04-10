/**
 * BOO-99A — Daily trial expiration drip (email + SMS), idempotent via business.notifications.sent.
 */
import { Business } from "../models/Business.js";
import { Booking } from "../models/Booking.js";
import { Call } from "../models/Call.js";
import { sendTrialDripEmail } from "./emailService.js";
import { sendSMS } from "./smsService.js";
import { isSubscribedBusiness } from "../src/utils/trialLifecycle.js";
import { buildTrialEmailInner, trialSmsText } from "./templates/trialDripI18n.js";

export function utcCalendarDaysSinceTrialStart(startedAt, now = new Date()) {
  const s = new Date(startedAt);
  const n = new Date(now);
  if (Number.isNaN(s.getTime())) return -1;
  const s0 = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const n0 = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return Math.floor((n0 - s0) / 86400000);
}

/**
 * @param {number} dayIndex — UTC calendar days since trial start (0 = first day)
 * @param {boolean} winbackEnabled
 * @returns {Array<{ id: string, channel: 'email'|'sms', emailKind?: string, smsKind?: string, campaignDay: string }>}
 */
export function notificationsForUtcDayIndex(dayIndex, winbackEnabled) {
  const out = [];
  if (dayIndex === 9) {
    out.push({ id: "trial-day-10-email", channel: "email", emailKind: "day10", campaignDay: "10" });
  }
  if (dayIndex === 12) {
    out.push({ id: "trial-day-13-email", channel: "email", emailKind: "day13", campaignDay: "13" });
  }
  if (dayIndex === 13) {
    out.push({ id: "trial-day-14-email", channel: "email", emailKind: "day14", campaignDay: "14" });
    out.push({ id: "trial-day-14-sms", channel: "sms", smsKind: "day14", campaignDay: "14" });
  }
  if (dayIndex === 14) {
    out.push({ id: "trial-day-15-sms", channel: "sms", smsKind: "day15", campaignDay: "15" });
  }
  if (dayIndex === 15) {
    out.push({ id: "trial-day-16-email", channel: "email", emailKind: "day16", campaignDay: "16" });
    out.push({ id: "trial-day-16-sms", channel: "sms", smsKind: "day16", campaignDay: "16" });
  }
  if (dayIndex === 16) {
    out.push({ id: "trial-day-17-email", channel: "email", emailKind: "day17", campaignDay: "17" });
  }
  if (winbackEnabled && dayIndex === 20) {
    out.push({ id: "trial-day-21-email", channel: "email", emailKind: "day21", campaignDay: "21" });
  }
  return out;
}

export function notificationAlreadySent(business, notificationId) {
  const arr = business.notifications?.sent;
  if (!Array.isArray(arr)) return false;
  return arr.some((x) => x && x.type === notificationId);
}

function ownerEmail(business) {
  const e = business.email || business.businessProfile?.email;
  return e ? String(e).trim() : "";
}

function ownerPhoneE164(business) {
  const p = business.phoneNumber;
  if (!p || typeof p !== "string") return "";
  const t = p.trim().replace(/\s/g, "");
  if (!t) return "";
  return t.startsWith("+") ? t : `+${t.replace(/^\+/, "")}`;
}

function firstNameFromBusiness(business) {
  const n = business.name || "there";
  return String(n).split(/\s+/)[0] || "there";
}

function upgradeUrlWithUtm(business, campaignDay) {
  const bid = encodeURIComponent(String(business.id || business.businessId || ""));
  return `https://book8.io/upgrade?businessId=${bid}&utm_source=trial_email&utm_campaign=day_${campaignDay}`;
}

function upgradeUrlSms(business, campaignDay) {
  const bid = encodeURIComponent(String(business.id || business.businessId || ""));
  return `https://book8.io/upgrade?businessId=${bid}&utm_source=trial_sms&utm_campaign=day_${campaignDay}`;
}

async function getUsageSince(businessId, since) {
  const s = since instanceof Date ? since : new Date(since);
  const [bookings, calls, languages] = await Promise.all([
    Booking.countDocuments({ businessId, createdAt: { $gte: s } }),
    Call.countDocuments({ businessId, createdAt: { $gte: s } }),
    Call.distinct("language", { businessId, createdAt: { $gte: s } })
  ]);
  const langList = (languages || []).filter(Boolean);
  return {
    bookings,
    calls,
    languageCount: Math.max(1, langList.length)
  };
}

/**
 * @returns {Promise<{ processed: number, sent: number, skipped: boolean, errors: string[] }>}
 */
export async function runTrialNotifications(now = new Date()) {
  const errors = [];
  if (process.env.TRIAL_NOTIFICATIONS_ENABLED === "false") {
    console.log("[trial-notifications] TRIAL_NOTIFICATIONS_ENABLED=false — skip");
    return { processed: 0, sent: 0, skipped: true, errors };
  }

  const winback = process.env.TRIAL_WINBACK_ENABLED === "true";
  const smsFrom = process.env.TWILIO_TRIAL_NOTIFY_FROM || process.env.BOOK8_SYSTEM_SMS_FROM || "";
  let warnedMissingSmsFrom = false;

  const businesses = await Business.find({
    "trial.startedAt": { $exists: true, $ne: null }
  }).lean();

  let sent = 0;

  for (const b of businesses) {
    try {
      if (isSubscribedBusiness(b)) continue;

      const started = b.trial?.startedAt;
      if (!started) continue;

      const dayIndex = utcCalendarDaysSinceTrialStart(started, now);
      if (dayIndex < 0) continue;

      const todo = notificationsForUtcDayIndex(dayIndex, winback);
      if (todo.length === 0) continue;

      const lang = b.primaryLanguage || b.language || "en";
      const bid = b.id || b.businessId;
      const stats = await getUsageSince(bid, started);
      const firstName = firstNameFromBusiness(b);

      for (const item of todo) {
        if (notificationAlreadySent(b, item.id)) continue;

        if (item.channel === "email") {
          const to = ownerEmail(b);
          if (!to) {
            console.warn(`[trial-notifications] No owner email for ${bid} — skip ${item.id}`);
            continue;
          }
          const upgradeUrl = upgradeUrlWithUtm(b, item.campaignDay);
          const { subject, body } = buildTrialEmailInner(lang, item.emailKind, {
            firstName,
            bookings: stats.bookings,
            calls: stats.calls,
            languageCount: stats.languageCount,
            upgradeUrl
          });
          const r = await sendTrialDripEmail({ to, subject, htmlInner: body, lang });
          if (r?.ok) {
            await Business.updateOne(
              { _id: b._id },
              { $push: { "notifications.sent": { type: item.id, sentAt: new Date(), channel: "email" } } }
            );
            sent++;
            console.log(`[trial-notifications] sent ${item.id} business=${bid}`);
          } else {
            errors.push(`${bid}:${item.id}:email_failed`);
          }
        } else if (item.channel === "sms") {
          if (!smsFrom) {
            if (!warnedMissingSmsFrom) {
              console.warn(
                "[trial-notifications] TWILIO_TRIAL_NOTIFY_FROM (or BOOK8_SYSTEM_SMS_FROM) not set — skipping trial SMS"
              );
              warnedMissingSmsFrom = true;
            }
            continue;
          }
          const to = ownerPhoneE164(b);
          if (!to) {
            console.warn(`[trial-notifications] No owner phone for ${bid} — skip ${item.id}`);
            continue;
          }
          const shortUrl = upgradeUrlSms(b, item.campaignDay);
          const body = trialSmsText(lang, item.smsKind, shortUrl);
          const r = await sendSMS({ to, from: smsFrom, body });
          if (r.ok) {
            await Business.updateOne(
              { _id: b._id },
              { $push: { "notifications.sent": { type: item.id, sentAt: new Date(), channel: "sms" } } }
            );
            sent++;
            console.log(`[trial-notifications] sent ${item.id} business=${bid}`);
          } else {
            errors.push(`${bid}:${item.id}:sms_failed`);
          }
        }
      }
    } catch (e) {
      errors.push(String(e?.message || e));
      console.error("[trial-notifications] business loop:", e);
    }
  }

  return { processed: businesses.length, sent, skipped: false, errors };
}

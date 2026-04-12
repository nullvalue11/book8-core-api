/**
 * BOO-102A — Single-business insights for monthly recap (aligned with aggregate revenue rules).
 * Non-cancelled bookings in range; revenue = sum of current Service.price per booking (lookup).
 */
import { Booking } from "../../models/Booking.js";
import { Call } from "../../models/Call.js";
import { Service } from "../../models/Service.js";
import { Schedule } from "../../models/Schedule.js";

const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

/**
 * Calendar month immediately before `now` (UTC boundaries). When cron runs April 1, last month is March.
 * @returns {{ start: Date, end: Date, fromIso: string, toIso: string, label: string, dedupKey: string }}
 */
export function previousMonthRange(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let py = y;
  let pm = m - 1;
  if (pm < 0) {
    pm = 11;
    py = y - 1;
  }
  const start = new Date(Date.UTC(py, pm, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(py, pm + 1, 0, 23, 59, 59, 999));
  const label = `${MONTH_NAMES_EN[pm]} ${py}`;
  const dedupKey = `monthly-insights-${MONTH_NAMES_EN[pm]}-${py}`;
  return {
    start,
    end,
    fromIso: start.toISOString(),
    toIso: end.toISOString(),
    label,
    dedupKey
  };
}

function parseHHMM(s) {
  const p = String(s || "").trim();
  const [h, min] = p.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function minutesSinceMidnightInTz(date, tz) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return hour * 60 + minute;
}

function weekdayKeyInTz(date, tz) {
  const d = date instanceof Date ? date : new Date(date);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d);
  return String(wd).toLowerCase();
}

function isWithinWeeklyHours(date, weeklyHours, tz) {
  const key = weekdayKeyInTz(date, tz);
  const ranges = weeklyHours[key];
  if (!Array.isArray(ranges) || ranges.length === 0) return false;
  const mins = minutesSinceMidnightInTz(date, tz);
  if (mins == null) return false;
  for (const r of ranges) {
    const s = parseHHMM(r.start);
    const e = parseHHMM(r.end);
    if (s == null || e == null) continue;
    if (mins >= s && mins < e) return true;
  }
  return false;
}

async function loadWeeklyHours(businessId) {
  const sch = await Schedule.findOne({ businessId }).lean();
  if (sch?.weeklyHours && typeof sch.weeklyHours === "object") {
    return sch.weeklyHours;
  }
  return {
    monday: [{ start: "09:00", end: "17:00" }],
    tuesday: [{ start: "09:00", end: "17:00" }],
    wednesday: [{ start: "09:00", end: "17:00" }],
    thursday: [{ start: "09:00", end: "17:00" }],
    friday: [{ start: "09:00", end: "17:00" }],
    saturday: [],
    sunday: []
  };
}

/**
 * @param {string} businessId
 * @param {{ fromIso: string, toIso: string }} range
 * @param {object} business - lean or doc with timezone
 */
export async function computeBusinessInsights(businessId, range, business = {}) {
  const { fromIso, toIso } = range;
  const tz = business.timezone || "America/Toronto";

  const [bookingsLean, callsLean, revenueAgg, svcList] = await Promise.all([
    Booking.find({
      businessId,
      status: { $ne: "cancelled" },
      "slot.start": { $gte: fromIso, $lte: toIso }
    })
      .select({ serviceId: 1, slot: 1 })
      .lean(),
    Call.find({
      businessId,
      createdAt: {
        $gte: new Date(fromIso),
        $lte: new Date(toIso)
      }
    })
      .select({ createdAt: 1, language: 1 })
      .lean(),
    Booking.aggregate([
      {
        $match: {
          businessId,
          status: { $ne: "cancelled" },
          "slot.start": { $gte: fromIso, $lte: toIso }
        }
      },
      {
        $lookup: {
          from: "services",
          let: { bid: "$businessId", sid: "$serviceId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ["$businessId", "$$bid"] }, { $eq: ["$serviceId", "$$sid"] }]
                }
              }
            }
          ],
          as: "svc"
        }
      },
      {
        $addFields: {
          price: { $ifNull: [{ $arrayElemAt: ["$svc.price", 0] }, 0] },
          currency: { $ifNull: [{ $arrayElemAt: ["$svc.currency", 0] }, "USD"] }
        }
      },
      { $group: { _id: null, total: { $sum: "$price" }, currency: { $first: "$currency" } } }
    ]),
    Service.find({ businessId }).select({ serviceId: 1, name: 1, price: 1, currency: 1 }).lean()
  ]);

  const svcById = new Map(svcList.map((s) => [s.serviceId, s]));
  const bookingsCount = bookingsLean.length;
  const callsCount = callsLean.length;

  let revenue = 0;
  let currency = "USD";
  if (revenueAgg.length) {
    revenue = Math.round(revenueAgg[0].total * 100) / 100;
    currency = String(revenueAgg[0].currency || "USD").toUpperCase().slice(0, 3);
  } else if (svcList.length) {
    currency = String(svcList[0].currency || "USD").toUpperCase().slice(0, 3);
  }

  const weeklyHours = await loadWeeklyHours(businessId);
  let callsOutsideHours = 0;
  for (const c of callsLean) {
    const t = c.createdAt ? new Date(c.createdAt) : null;
    if (!t) continue;
    if (!isWithinWeeklyHours(t, weeklyHours, tz)) {
      callsOutsideHours += 1;
    }
  }

  const languageCounts = {};
  for (const c of callsLean) {
    const lang = (c.language && String(c.language).trim().toLowerCase().slice(0, 5)) || "en";
    languageCounts[lang] = (languageCounts[lang] || 0) + 1;
  }

  const perService = new Map();
  for (const b of bookingsLean) {
    const sid = b.serviceId;
    if (!sid) continue;
    const cur = perService.get(sid) || { count: 0 };
    cur.count += 1;
    perService.set(sid, cur);
  }

  const topServices = [];
  for (const [serviceId, v] of perService) {
    const svc = svcById.get(serviceId);
    const price = svc && typeof svc.price === "number" ? svc.price : 0;
    const name = svc?.name || serviceId;
    const ccy = String(svc?.currency || currency || "USD").toUpperCase().slice(0, 3);
    topServices.push({
      serviceId,
      name,
      bookingsCount: v.count,
      revenue: Math.round(v.count * price * 100) / 100,
      currency: ccy
    });
  }
  topServices.sort((a, b) => b.bookingsCount - a.bookingsCount);
  const top3 = topServices.slice(0, 3);

  return {
    bookingsCount,
    callsCount,
    callsOutsideHours,
    revenue,
    currency,
    languageCounts,
    topServices: top3
  };
}

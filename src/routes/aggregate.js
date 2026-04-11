// BOO-67A — Multi-location aggregate APIs (Enterprise only)
import express from "express";
import { Business } from "../../models/Business.js";
import { Booking } from "../../models/Booking.js";
import { Call } from "../../models/Call.js";
import { Service } from "../../models/Service.js";
import { isFeatureAllowed } from "../config/plans.js";

const UPGRADE = {
  error: "Multi-location features require the Enterprise plan",
  upgradeUrl: "https://www.book8.io/pricing"
};

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Owner identity: dashboard sends header (preferred) or ?ownerEmail= for GET. */
function getAggregateOwnerEmail(req) {
  const h = req.headers["x-book8-user-email"];
  if (typeof h === "string" && h.trim()) return h.trim();
  const q = req.query?.ownerEmail;
  if (typeof q === "string" && q.trim()) return q.trim();
  return "";
}

async function findBusinessesForOwnerEmail(email) {
  const re = new RegExp(`^${escapeRegex(email)}$`, "i");
  return Business.find({
    $or: [{ email: re }, { "businessProfile.email": re }, { ownerEmail: re }]
  }).lean();
}

function businessIdsFromDocs(businesses) {
  return businesses.map((b) => String(b.businessId || b.id || "")).filter(Boolean);
}

function requireEnterpriseAggregate(req, res, next) {
  const ownerEmail = getAggregateOwnerEmail(req);
  if (!ownerEmail) {
    return res.status(400).json({
      ok: false,
      error: "x-book8-user-email header or ownerEmail query parameter is required"
    });
  }

  findBusinessesForOwnerEmail(ownerEmail)
    .then((businesses) => {
      req.aggregateBusinesses = businesses;
      req.aggregateBusinessIds = businessIdsFromDocs(businesses);

      if (businesses.length === 0) {
        return next();
      }

      const blocked = businesses.some(
        (b) => !isFeatureAllowed(b.plan || "starter", "multiLocationAggregate")
      );
      if (blocked) {
        return res.status(403).json(UPGRADE);
      }
      next();
    })
    .catch((err) => {
      console.error("[aggregate] owner lookup:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    });
}

function utcTodayBounds() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: now };
}

function utcWeekBounds() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff)
  );
  return { start, end: now };
}

function utcMonthBounds() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: now };
}

/** ISO string compare works for slot.start when stored as ISO-8601. */
function isoInRange(iso, fromIso, toIso) {
  if (!iso || typeof iso !== "string") return false;
  return iso >= fromIso && iso <= toIso;
}

function parsePagination(req) {
  let limit = parseInt(String(req.query.limit ?? "50"), 10);
  let offset = parseInt(String(req.query.offset ?? "0"), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset };
}

function parseFromTo(req) {
  const fromQ = req.query.from;
  const toQ = req.query.to;
  if (fromQ && toQ) {
    const from = new Date(String(fromQ));
    const to = new Date(String(toQ));
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return { fromIso: from.toISOString(), toIso: to.toISOString() };
    }
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

function analyticsRange(period) {
  const now = new Date();
  const end = now;
  let start;
  if (period === "week") {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === "quarter") {
    start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  } else {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return { start, end, fromIso: start.toISOString(), toIso: end.toISOString() };
}

function scheduleToWeeklyHours(schedule) {
  if (!schedule || typeof schedule !== "object") return null;
  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
  ];
  const weeklyHours = {};
  for (const d of days) {
    const block = schedule[d];
    if (block && block.open && block.close) {
      weeklyHours[d] = [{ start: String(block.open), end: String(block.close) }];
    }
  }
  return Object.keys(weeklyHours).length ? { weeklyHours } : null;
}

/**
 * @param {object} deps
 * @param {import("express").RequestHandler} deps.requireApiKey
 */
export default function createAggregateRouter(deps) {
  const { requireApiKey } = deps;
  const router = express.Router();

  router.get("/aggregate/stats", requireApiKey, requireEnterpriseAggregate, async (req, res) => {
    try {
      const ids = req.aggregateBusinessIds;
      const bizMap = new Map(
        (req.aggregateBusinesses || []).map((b) => [String(b.businessId || b.id), b])
      );

      if (ids.length === 0) {
        return res.json({
          totalBusinesses: 0,
          totalBookingsToday: 0,
          totalBookingsThisWeek: 0,
          totalBookingsThisMonth: 0,
          totalCallsToday: 0,
          totalCallsThisWeek: 0,
          totalCallsThisMonth: 0,
          totalNoShows: 0,
          totalCancellations: 0,
          totalRevenue: 0,
          businesses: []
        });
      }

      const tDay = utcTodayBounds();
      const tWeek = utcWeekBounds();
      const tMonth = utcMonthBounds();

      const dayFrom = tDay.start.toISOString();
      const dayTo = tDay.end.toISOString();
      const weekFrom = tWeek.start.toISOString();
      const weekTo = tWeek.end.toISOString();
      const monthFrom = tMonth.start.toISOString();
      const monthTo = tMonth.end.toISOString();

      const bookings = await Booking.find({
        businessId: { $in: ids }
      })
        .select({
          businessId: 1,
          slot: 1,
          status: 1,
          noShow: 1,
          serviceId: 1
        })
        .lean();

      const countSlot = (fromIso, toIso) => {
        let n = 0;
        for (const b of bookings) {
          const start = b.slot?.start;
          if (!start) continue;
          if (!isoInRange(start, fromIso, toIso)) continue;
          if (String(b.status).toLowerCase() === "cancelled") continue;
          n += 1;
        }
        return n;
      };

      const totalBookingsToday = countSlot(dayFrom, dayTo);
      const totalBookingsThisWeek = countSlot(weekFrom, weekTo);
      const totalBookingsThisMonth = countSlot(monthFrom, monthTo);

      const calls = await Call.find({ businessId: { $in: ids } })
        .select({ businessId: 1, createdAt: 1 })
        .lean();

      const countCalls = (fromD, toD) =>
        calls.filter((c) => {
          const t = c.createdAt ? new Date(c.createdAt) : null;
          return t && t >= fromD && t <= toD;
        }).length;

      const totalCallsToday = countCalls(tDay.start, tDay.end);
      const totalCallsThisWeek = countCalls(tWeek.start, tWeek.end);
      const totalCallsThisMonth = countCalls(tMonth.start, tMonth.end);

      let totalNoShows = 0;
      let totalCancellations = 0;
      for (const b of bookings) {
        const start = b.slot?.start;
        if (!start || !isoInRange(start, monthFrom, monthTo)) continue;
        if (b.noShow) totalNoShows += 1;
        if (String(b.status).toLowerCase() === "cancelled") totalCancellations += 1;
      }

      const revenueAgg = await Booking.aggregate([
        {
          $match: {
            businessId: { $in: ids },
            status: { $ne: "cancelled" },
            "slot.start": { $gte: monthFrom, $lte: monthTo }
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
            price: { $ifNull: [{ $arrayElemAt: ["$svc.price", 0] }, 0] }
          }
        },
        { $group: { _id: null, total: { $sum: "$price" } } }
      ]);
      const totalRevenue = revenueAgg.length ? Math.round(revenueAgg[0].total * 100) / 100 : 0;

      const perBiz = [];
      for (const bid of ids) {
        const bdoc = bizMap.get(bid);
        const name = bdoc?.name || bid;
        let bt = 0;
        let ct = 0;
        let ns = 0;
        let denom = 0;
        for (const b of bookings) {
          if (b.businessId !== bid) continue;
          const start = b.slot?.start;
          if (!start || !isoInRange(start, dayFrom, dayTo)) continue;
          if (String(b.status).toLowerCase() === "cancelled") continue;
          bt += 1;
        }
        for (const c of calls) {
          if (c.businessId !== bid) continue;
          const t = c.createdAt ? new Date(c.createdAt) : null;
          if (t && t >= tDay.start && t <= tDay.end) ct += 1;
        }
        for (const b of bookings) {
          if (b.businessId !== bid) continue;
          const start = b.slot?.start;
          if (!start || !isoInRange(start, monthFrom, monthTo)) continue;
          denom += 1;
          if (b.noShow) ns += 1;
        }
        const noShowRate = denom > 0 ? Math.round((ns / denom) * 1000) / 10 : 0;
        perBiz.push({
          id: bid,
          name,
          bookingsToday: bt,
          callsToday: ct,
          noShowRate
        });
      }

      res.json({
        totalBusinesses: ids.length,
        totalBookingsToday,
        totalBookingsThisWeek,
        totalBookingsThisMonth,
        totalCallsToday,
        totalCallsThisWeek,
        totalCallsThisMonth,
        totalNoShows,
        totalCancellations,
        totalRevenue,
        businesses: perBiz
      });
    } catch (err) {
      console.error("[aggregate/stats]", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/aggregate/bookings", requireApiKey, requireEnterpriseAggregate, async (req, res) => {
    try {
      const ids = req.aggregateBusinessIds;
      const { fromIso, toIso } = parseFromTo(req);
      const { limit, offset } = parsePagination(req);
      const statusFilter = req.query.status
        ? String(req.query.status).toLowerCase()
        : null;

      if (ids.length === 0) {
        return res.json({ total: 0, bookings: [] });
      }

      const q = {
        businessId: { $in: ids },
        "slot.start": { $gte: fromIso, $lte: toIso }
      };
      if (statusFilter) q.status = statusFilter;

      const total = await Booking.countDocuments(q);
      const rows = await Booking.find(q)
        .sort({ "slot.start": -1 })
        .skip(offset)
        .limit(limit)
        .lean();

      const bizMap = new Map(
        (req.aggregateBusinesses || []).map((b) => [String(b.businessId || b.id), b?.name || ""])
      );

      const seenSvc = new Set();
      const ors = [];
      for (const r of rows) {
        const k = `${r.businessId}\0${r.serviceId}`;
        if (seenSvc.has(k)) continue;
        seenSvc.add(k);
        ors.push({ businessId: r.businessId, serviceId: r.serviceId });
      }
      const svcDocs =
        ors.length > 0 ? await Service.find({ $or: ors }).select({ businessId: 1, serviceId: 1, name: 1 }).lean() : [];
      const serviceNames = new Map(svcDocs.map((s) => [`${s.businessId}:${s.serviceId}`, s.name || s.serviceId]));

      const bookings = rows.map((r) => ({
        id: r.id,
        businessId: r.businessId,
        businessName: bizMap.get(r.businessId) || r.businessId,
        clientName: r.customer?.name || "",
        service: serviceNames.get(`${r.businessId}:${r.serviceId}`) || r.serviceId,
        provider: r.providerName || "",
        dateTime: r.slot?.start || null,
        status: r.status || "confirmed",
        language: r.language || "en"
      }));

      res.json({ total, bookings });
    } catch (err) {
      console.error("[aggregate/bookings]", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/aggregate/calls", requireApiKey, requireEnterpriseAggregate, async (req, res) => {
    try {
      const ids = req.aggregateBusinessIds;
      const { fromIso, toIso } = parseFromTo(req);
      const { limit, offset } = parsePagination(req);

      if (ids.length === 0) {
        return res.json({ total: 0, calls: [] });
      }

      const fromD = new Date(fromIso);
      const toD = new Date(toIso);

      const q = {
        businessId: { $in: ids },
        createdAt: { $gte: fromD, $lte: toD }
      };

      const total = await Call.countDocuments(q);
      const rows = await Call.find(q)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();

      const bizMap = new Map(
        (req.aggregateBusinesses || []).map((b) => [String(b.businessId || b.id), b?.name || ""])
      );

      const calls = rows.map((c) => ({
        id: c.callSid || c._id?.toString(),
        businessId: c.businessId,
        businessName: bizMap.get(c.businessId) || c.businessId,
        from: c.from || "",
        to: c.to || "",
        status: c.status || "",
        durationSeconds: c.durationSeconds ?? null,
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
        language: c.language || "en"
      }));

      res.json({ total, calls });
    } catch (err) {
      console.error("[aggregate/calls]", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.get("/aggregate/analytics", requireApiKey, requireEnterpriseAggregate, async (req, res) => {
    try {
      const ids = req.aggregateBusinessIds;
      const period = String(req.query.period || "month").toLowerCase();
      const p = ["week", "month", "quarter"].includes(period) ? period : "month";
      const { fromIso, toIso, start, end } = analyticsRange(p);

      if (ids.length === 0) {
        return res.json({
          period: p,
          bookingsTrend: [],
          noShowRate: 0,
          topLanguages: [],
          topServices: [],
          byLocation: []
        });
      }

      const bookings = await Booking.find({
        businessId: { $in: ids },
        "slot.start": { $gte: fromIso, $lte: toIso }
      })
        .select({
          businessId: 1,
          slot: 1,
          status: 1,
          noShow: 1,
          serviceId: 1,
          language: 1
        })
        .lean();

      const trendMap = new Map();
      const langMap = new Map();
      const svcMap = new Map();
      const byLoc = new Map();

      let noShowNumer = 0;
      let noShowDenom = 0;

      for (const b of bookings) {
        const start = b.slot?.start;
        if (!start) continue;
        const day = start.slice(0, 10);
        trendMap.set(day, (trendMap.get(day) || 0) + 1);

        const lang = (b.language || "en").toLowerCase();
        langMap.set(lang, (langMap.get(lang) || 0) + 1);

        const sk = `${b.businessId}\0${b.serviceId}`;
        svcMap.set(sk, (svcMap.get(sk) || 0) + 1);

        if (String(b.status).toLowerCase() !== "cancelled") {
          noShowDenom += 1;
          if (b.noShow) noShowNumer += 1;
        }

        const bid = b.businessId;
        if (!byLoc.has(bid)) {
          byLoc.set(bid, { bookings: 0, noShow: 0, denom: 0 });
        }
        const bl = byLoc.get(bid);
        bl.bookings += 1;
        if (String(b.status).toLowerCase() !== "cancelled") {
          bl.denom += 1;
          if (b.noShow) bl.noShow += 1;
        }
      }

      const bookingsTrend = [...trendMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ date, count }));

      const langTotal = [...langMap.values()].reduce((a, b) => a + b, 0);
      const topLanguages = [...langMap.entries()]
        .map(([language, count]) => ({
          language,
          percentage: langTotal ? Math.round((count / langTotal) * 1000) / 10 : 0
        }))
        .sort((a, b) => b.percentage - a.percentage);

      const svcPairs = [...svcMap.entries()].map(([key, count]) => {
        const idx = key.indexOf("\0");
        const businessId = idx === -1 ? key : key.slice(0, idx);
        const serviceId = idx === -1 ? "" : key.slice(idx + 1);
        return { businessId, serviceId, count };
      });
      const svcOr = svcPairs.map((p) => ({ businessId: p.businessId, serviceId: p.serviceId }));
      const svcDocs =
        svcOr.length > 0
          ? await Service.find({ $or: svcOr }).select({ businessId: 1, serviceId: 1, name: 1 }).lean()
          : [];
      const svcNameByKey = new Map(
        svcDocs.map((s) => [`${s.businessId}\0${s.serviceId}`, s.name || s.serviceId])
      );
      const svcCounts = svcPairs.map((p) => ({
        service: svcNameByKey.get(`${p.businessId}\0${p.serviceId}`) || p.serviceId,
        count: p.count
      }));
      svcCounts.sort((a, b) => b.count - a.count);
      const topServices = svcCounts.slice(0, 20);

      const calls = await Call.find({
        businessId: { $in: ids },
        createdAt: { $gte: start, $lte: end }
      })
        .select({ businessId: 1 })
        .lean();
      const callByBiz = new Map();
      for (const c of calls) {
        callByBiz.set(c.businessId, (callByBiz.get(c.businessId) || 0) + 1);
      }

      const bizMap = new Map(
        (req.aggregateBusinesses || []).map((b) => [String(b.businessId || b.id), b?.name || ""])
      );

      const byLocation = ids.map((bid) => {
        const bl = byLoc.get(bid) || { bookings: 0, noShow: 0, denom: 0 };
        const callsN = callByBiz.get(bid) || 0;
        const noShowRate =
          bl.denom > 0 ? Math.round((bl.noShow / bl.denom) * 1000) / 10 : 0;
        return {
          businessId: bid,
          businessName: bizMap.get(bid) || bid,
          bookings: bl.bookings,
          calls: callsN,
          noShowRate
        };
      });

      const noShowRate = noShowDenom > 0 ? Math.round((noShowNumer / noShowDenom) * 1000) / 10 : 0;

      res.json({
        period: p,
        bookingsTrend,
        noShowRate,
        topLanguages,
        topServices,
        byLocation
      });
    } catch (err) {
      console.error("[aggregate/analytics]", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  router.post("/aggregate/settings", requireApiKey, requireEnterpriseAggregate, async (req, res) => {
    try {
      const ids = req.aggregateBusinessIds;
      const { businessIds = [], settings = {} } = req.body || {};

      if (!Array.isArray(businessIds) || businessIds.length === 0) {
        return res.status(400).json({ ok: false, error: "businessIds array is required" });
      }
      if (!settings || typeof settings !== "object") {
        return res.status(400).json({ ok: false, error: "settings object is required" });
      }

      const allowed = new Set(ids);
      for (const id of businessIds) {
        if (!allowed.has(String(id))) {
          return res.status(403).json({
            ok: false,
            error: "One or more businessIds are not owned by this user"
          });
        }
      }

      const updates = {};
      if (settings.noShowProtection && typeof settings.noShowProtection === "object") {
        updates.noShowProtection = settings.noShowProtection;
      }
      if (settings.bookingSettings && typeof settings.bookingSettings === "object") {
        updates.bookingSettings = settings.bookingSettings;
      }
      if (settings.schedule && typeof settings.schedule === "object") {
        const wh = scheduleToWeeklyHours(settings.schedule);
        if (wh && wh.weeklyHours) {
          updates["weeklySchedule.weeklyHours"] = wh.weeklyHours;
        }
      }
      if (settings.weeklySchedule && typeof settings.weeklySchedule === "object") {
        updates.weeklySchedule = settings.weeklySchedule;
      }
      if (settings.multilingualEnabled !== undefined) {
        updates.multilingualEnabled = !!settings.multilingualEnabled;
      }
      if (settings.primaryLanguage !== undefined) {
        updates.primaryLanguage = String(settings.primaryLanguage).slice(0, 16);
      }
      if (settings.supportedLanguages !== undefined) {
        updates.supportedLanguages = Array.isArray(settings.supportedLanguages)
          ? settings.supportedLanguages.map((x) => String(x).slice(0, 16))
          : [];
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({
          ok: false,
          error: "No supported settings keys in body (noShowProtection, bookingSettings, schedule, weeklySchedule, multilingualEnabled, primaryLanguage, supportedLanguages)"
        });
      }

      const results = [];
      for (const bid of businessIds) {
        const doc = await Business.findOneAndUpdate(
          { $or: [{ id: bid }, { businessId: bid }] },
          { $set: updates },
          { new: true }
        ).lean();
        results.push({ businessId: bid, updated: !!doc });
      }

      res.json({ ok: true, updated: results });
    } catch (err) {
      console.error("[aggregate/settings]", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  return router;
}

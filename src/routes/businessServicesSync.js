// BOO-84A Bug 2 — POST /api/businesses/:id/services/sync (replace-all catalog sync)
import express from "express";
import { Service } from "../../models/Service.js";
import { findBusinessByParam, ownerHeaderMatchesBusiness } from "../utils/businessRouteHelpers.js";
import { trialDeniedDashboardWrite } from "../utils/trialLifecycle.js";

/**
 * @param {import("express").RequestHandler} requireApiKey
 */
export default function createBusinessServicesSyncRouter(requireApiKey) {
  const router = express.Router();

  router.post("/:id/services/sync", requireApiKey, async (req, res) => {
    try {
      const { id } = req.params;
      const { services: servicesInput } = req.body || {};
      if (!Array.isArray(servicesInput)) {
        return res.status(400).json({ ok: false, error: "services must be an array" });
      }
      const resolved = await findBusinessByParam(id);
      if (!resolved) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }
      const { business, businessId } = resolved;
      const td = trialDeniedDashboardWrite(business);
      if (td) return res.status(td.status).json(td.body);

      const ownerHeader = req.headers["x-book8-user-email"];
      if (ownerHeader && String(ownerHeader).trim()) {
        if (!ownerHeaderMatchesBusiness(business, ownerHeader)) {
          return res.status(403).json({
            ok: false,
            error: "Forbidden: x-book8-user-email does not match this business owner"
          });
        }
      }

      const mapped = [];
      for (const raw of servicesInput) {
        if (!raw || typeof raw !== "object") continue;
        const sid = String(raw.serviceId || "").trim();
        const name = String(raw.name || "").trim();
        if (!sid || !name) continue;
        const durationMinutes = Number(raw.durationMinutes);
        if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) continue;
        let price = null;
        if (raw.price != null && raw.price !== "") {
          const n = Number(raw.price);
          if (!Number.isNaN(n)) price = n;
        }
        if (price == null && raw.priceCents != null && raw.priceCents !== "") {
          const c = Number(raw.priceCents);
          if (!Number.isNaN(c)) price = c / 100;
        }
        const currency = raw.currency
          ? String(raw.currency).trim().toUpperCase().slice(0, 3)
          : "USD";
        const active = raw.active !== false;
        mapped.push({ businessId, serviceId: sid, name, durationMinutes, price, currency, active });
      }

      const incomingIds = new Set(mapped.map((s) => s.serviceId));
      const existing = await Service.find({ businessId }).lean();
      const toDelete = existing.filter((e) => !incomingIds.has(e.serviceId));
      let deleted = 0;
      if (toDelete.length) {
        const del = await Service.deleteMany({
          businessId,
          serviceId: { $in: toDelete.map((e) => e.serviceId) }
        });
        deleted = del.deletedCount || 0;
      }

      let added = 0;
      let updated = 0;
      for (const m of mapped) {
        const r = await Service.updateOne(
          { businessId, serviceId: m.serviceId },
          {
            $set: {
              businessId: m.businessId,
              serviceId: m.serviceId,
              name: m.name,
              durationMinutes: m.durationMinutes,
              price: m.price,
              currency: m.currency,
              active: m.active
            }
          },
          { upsert: true }
        );
        if (r.upsertedCount) added += 1;
        else if (r.modifiedCount) updated += 1;
      }

      console.log("[service-sync]", { businessId, added, updated, deleted });

      res.json({ ok: true, added, updated, deleted });
    } catch (err) {
      console.error("Error in POST /api/businesses/:id/services/sync:", err);
      res.status(500).json({ ok: false, error: "Internal server error" });
    }
  });

  return router;
}

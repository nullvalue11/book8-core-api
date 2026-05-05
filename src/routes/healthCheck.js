// src/routes/healthCheck.js
import express from "express";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import { Schedule } from "../../models/Schedule.js";
import { businessLookupFilter, canonicalBusinessId } from "../../services/provisioningHelpers.js";
import { getPlanFeatures } from "../config/plans.js";
import { getVerticalPromptAddendum } from "../utils/verticalPromptAddendum.js";

const router = express.Router();

/**
 * GET /business/:businessId
 * Auth: requireInternalAuth on mount (x-internal-secret / CORE_API_INTERNAL_SECRET)
 */
router.get("/business/:businessId", async (req, res) => {
  const { businessId } = req.params;

  try {
    const business = await Business.findOne(businessLookupFilter(businessId)).lean();

    if (!business) {
      return res.json({
        ok: false,
        businessId,
        plan: null,
        planFeatures: null,
        status: "NOT_FOUND",
        message: "Business does not exist in core-api database",
        checks: {
          business_record: { ok: false, detail: "Not found" },
          services: { ok: false, detail: "N/A" },
          schedule: { ok: false, detail: "N/A" },
          phone_number: { ok: false, detail: "N/A" },
          calendar: { ok: false, detail: "N/A" },
          elevenlabs: { ok: false, detail: "N/A" },
          webhooks: { ok: false, detail: "N/A" }
        }
      });
    }

    const canonicalId = canonicalBusinessId(business);
    const checks = {};

    checks.business_record = {
      ok: true,
      detail: `Found: ${business.name || "unnamed"}`,
      canonical_id: business.id || null,
      has_businessId_field: !!business.businessId,
      field_mismatch:
        !!(business.id && business.businessId && business.id !== business.businessId)
    };

    const embedded = business.services || [];
    let serviceCount = await Service.countDocuments({ businessId: canonicalId });
    if (serviceCount === 0 && embedded.length > 0) {
      serviceCount = embedded.length;
    }
    checks.services = {
      ok: serviceCount > 0,
      detail:
        serviceCount > 0
          ? `${serviceCount} service(s) in Service collection or embedded`
          : "No services configured"
    };

    const scheduleDoc = canonicalId
      ? await Schedule.findOne({ businessId: canonicalId }).lean()
      : null;
    const ws = business.weeklySchedule;
    const hasSchedule =
      !!scheduleDoc ||
      !!(ws && (ws.weeklyHours || (typeof ws === "object" && Object.keys(ws).length > 0)));
    checks.schedule = {
      ok: hasSchedule,
      detail: hasSchedule ? "Business hours configured" : "No business hours set"
    };

    const phone =
      business.assignedTwilioNumber || business.phoneNumber || business.phone;
    checks.phone_number = {
      ok: !!phone,
      detail: phone ? `Assigned: ${phone}` : "No phone number assigned"
    };

    const cal = business.calendar || {};
    const calConnected = cal.connected || business.calendarProvider;
    checks.calendar = {
      ok: !!calConnected,
      detail: calConnected
        ? `Connected: ${business.calendarProvider || cal.provider || "unknown"}`
        : "Not connected (optional but recommended)"
    };

    const elevenLabs = business.elevenLabsAgentId || business.agentId;
    checks.elevenlabs = {
      ok: !!elevenLabs,
      detail: elevenLabs ? `Agent registered: ${elevenLabs}` : "Not registered with ElevenLabs (optional)"
    };

    const webhooksConfigured = business.webhooksConfigured || business.twilioWebhooksSet;
    checks.webhooks = {
      ok: !!webhooksConfigured || !!phone,
      detail: webhooksConfigured
        ? "Webhooks flag set"
        : phone
          ? "Phone assigned (webhooks assumed configured at provision time)"
          : "No webhooks"
    };

    const criticalChecks = ["business_record", "services", "schedule", "phone_number"];
    const allCriticalOk = criticalChecks.every((k) => checks[k].ok);
    const allOk = Object.values(checks).every((c) => c.ok);

    const plan = business.plan || "starter";
    const planFeatures = { ...getPlanFeatures(plan) };
    const addendum = getVerticalPromptAddendum(business.category);

    return res.json({
      ok: allCriticalOk,
      businessId,
      plan,
      planFeatures,
      status: allOk
        ? "FULLY_PROVISIONED"
        : allCriticalOk
          ? "PARTIALLY_PROVISIONED"
          : "INCOMPLETE",
      message: allOk
        ? "Business is fully provisioned and ready for calls"
        : allCriticalOk
          ? "Core booking works but some optional features missing"
          : "Business is NOT ready — critical provisioning steps incomplete",
      checks,
      raw: {
        id_field: business.id || null,
        businessId_field: business.businessId || null,
        name: business.name || null,
        createdAt: business.createdAt || null,
        verticalPromptHeadline: addendum.split("\n")[0] || "none"
      }
    });
  } catch (err) {
    console.error("[health-check] Error:", err);
    return res.status(500).json({
      ok: false,
      businessId,
      status: "ERROR",
      message: err.message
    });
  }
});

/**
 * GET /all
 */
router.get("/all", async (req, res) => {
  try {
    const businesses = await Business.find({}).lean();

    const results = await Promise.all(
      businesses.map(async (biz) => {
        const id = canonicalBusinessId(biz) || biz._id?.toString();
        const embedded = biz.services || [];
        let svcCount = await Service.countDocuments({ businessId: id });
        if (svcCount === 0 && embedded.length) svcCount = embedded.length;

        const scheduleDoc = id ? await Schedule.findOne({ businessId: id }).lean() : null;
        const ws = biz.weeklySchedule;
        const hasSchedule =
          !!scheduleDoc ||
          !!(ws && (ws.weeklyHours || (typeof ws === "object" && Object.keys(ws).length > 0)));

        const phone = biz.assignedTwilioNumber || biz.phoneNumber || biz.phone;
        const cal = biz.calendar || {};

        return {
          businessId: id,
          name: biz.name || "unnamed",
          hasServices: svcCount > 0,
          hasSchedule: !!hasSchedule,
          hasPhone: !!phone,
          phone: phone || null,
          hasCalendar: !!(cal.connected || biz.calendarProvider),
          calendarProvider: biz.calendarProvider || null,
          hasElevenLabs: !!(biz.elevenLabsAgentId || biz.agentId),
          fieldMismatch: !!(biz.id && biz.businessId && biz.id !== biz.businessId),
          status: svcCount > 0 && hasSchedule && phone ? "READY" : "INCOMPLETE"
        };
      })
    );

    return res.json({
      ok: true,
      total: results.length,
      ready: results.filter((r) => r.status === "READY").length,
      incomplete: results.filter((r) => r.status === "INCOMPLETE").length,
      businesses: results
    });
  } catch (err) {
    console.error("[health-check] Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;

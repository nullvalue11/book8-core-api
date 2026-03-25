// src/routes/provisioningRetry.js
import express from "express";
import {
  assignTwilioNumberFromPool,
  configureWebhooksAndElevenLabsForBusiness,
  runServicesAndScheduleBootstrap
} from "../../services/provisioningHelpers.js";

const router = express.Router();

/**
 * POST /retry/:businessId
 * Body: { steps?: ('twilio'|'elevenlabs'|'webhooks'|'services'|'schedule')[] }
 * Empty / omitted steps → run full retry bundle (Twilio assign, bootstrap, webhooks+ElevenLabs).
 */
router.post("/retry/:businessId", async (req, res) => {
  const { businessId } = req.params;
  const stepsToRun = Array.isArray(req.body?.steps) ? req.body.steps : [];
  const runAll = stepsToRun.length === 0;
  const results = {};

  const wants = (name) => runAll || stepsToRun.includes(name);

  try {
    if (runAll) {
      try {
        results.twilio = await assignTwilioNumberFromPool(businessId);
      } catch (err) {
        results.twilio = { ok: false, detail: err.message };
      }
      try {
        results.bootstrap = await runServicesAndScheduleBootstrap(businessId);
      } catch (err) {
        results.bootstrap = { ok: false, detail: err.message };
      }
      try {
        results.webhooks_elevenlabs = await configureWebhooksAndElevenLabsForBusiness(businessId);
      } catch (err) {
        results.webhooks_elevenlabs = { ok: false, detail: err.message };
      }
    } else {
      if (wants("twilio")) {
        try {
          results.twilio = await assignTwilioNumberFromPool(businessId);
        } catch (err) {
          results.twilio = { ok: false, detail: err.message };
        }
      }
      if (wants("services") || wants("schedule")) {
        try {
          results.bootstrap = await runServicesAndScheduleBootstrap(businessId);
        } catch (err) {
          results.bootstrap = { ok: false, detail: err.message };
        }
      }
      if (wants("webhooks") || wants("elevenlabs")) {
        try {
          results.webhooks_elevenlabs = await configureWebhooksAndElevenLabsForBusiness(businessId);
        } catch (err) {
          results.webhooks_elevenlabs = { ok: false, detail: err.message };
        }
      }
    }

    return res.json({
      ok: true,
      businessId,
      message: "Retry completed — check results for each step",
      results
    });
  } catch (err) {
    console.error("[provisioning-retry] Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;

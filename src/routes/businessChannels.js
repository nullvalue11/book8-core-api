// BOO-WIZARD-COUNTRY-BRANCH-1A — wizard: channel availability before business exists
import express from "express";
import {
  getAvailableChannels,
  getVoiceBlockedReason,
  isVoiceBlocked
} from "../config/voiceCountries.js";
import { resolveCountryIsoForBusiness } from "../utils/businessCountry.js";
import { strictLimiter } from "../middleware/strictLimiter.js";

const router = express.Router();

router.get("/channels", strictLimiter, (req, res) => {
  try {
    const raw = req.query.country;
    const iso = resolveCountryIsoForBusiness(
      raw != null && String(raw).trim() !== "" ? String(raw).trim() : null
    );
    const channels = getAvailableChannels(iso);
    const voiceBlocked = isVoiceBlocked(iso);
    const reason = getVoiceBlockedReason(iso);
    const payload = { country: iso, channels, voiceBlocked };
    if (reason) payload.voiceBlockedReason = reason;
    res.json(payload);
  } catch (err) {
    console.error("[GET /api/business/channels]", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

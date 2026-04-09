// BOO-59A — POST public, GET/DELETE internal or cancel token
import express from "express";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { publicBookingLimiter } from "../middleware/publicBookingLimiter.js";
import { requireInternalAuth, safeCompare } from "../middleware/internalAuth.js";
import {
  joinWaitlist,
  listWaitlistEntries,
  removeWaitlistEntry
} from "../../services/waitlistService.js";

const router = express.Router();

router.post("/:id/waitlist", strictLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await joinWaitlist(id, req.body || {});
    if (!result.ok) {
      return res.status(result.status).json({
        ok: false,
        error: result.error,
        requiredPlan: result.requiredPlan,
        upgrade: result.upgrade
      });
    }
    return res.status(201).json({
      ok: true,
      waitlistId: result.waitlistId,
      position: result.position,
      cancelToken: result.cancelToken
    });
  } catch (err) {
    console.error("[POST waitlist]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/:id/waitlist", requireInternalAuth, strictLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await listWaitlistEntries(id, req.query || {});
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true, businessId: result.businessId, entries: result.entries });
  } catch (err) {
    console.error("[GET waitlist]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.delete("/:id/waitlist/:waitlistId", publicBookingLimiter, async (req, res) => {
  try {
    const { id, waitlistId } = req.params;
    const token = req.query?.token;
    const expectedSecret =
      process.env.CORE_API_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET;
    const authHeader = req.headers["x-internal-secret"] || req.headers["x-book8-internal-secret"];

    let auth = { type: "none" };
    if (expectedSecret && authHeader && safeCompare(authHeader, expectedSecret)) {
      auth = { type: "internal" };
    } else if (token && typeof token === "string") {
      auth = { type: "token", token };
    } else {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const result = await removeWaitlistEntry(id, waitlistId, auth);
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, error: result.error });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE waitlist]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

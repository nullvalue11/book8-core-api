/**
 * GET /internal/twilio-pool/status — pool counts and list of numbers.
 * Auth: x-book8-internal-secret (requireInternalAuth).
 */
import express from "express";
import { TwilioNumber } from "../../models/TwilioNumber.js";

const router = express.Router();

router.get("/status", async (req, res) => {
  try {
    const numbers = await TwilioNumber.find({}).sort({ phoneNumber: 1 }).lean();
    const total = numbers.length;
    const available = numbers.filter((n) => n.status === "available").length;
    const assigned = numbers.filter((n) => n.status === "assigned").length;
    const reserved = numbers.filter((n) => n.status === "reserved").length;

    const list = numbers.map((n) => ({
      phoneNumber: n.phoneNumber,
      status: n.status,
      assignedTo: n.assignedToBusinessId ?? null,
      areaCode: n.areaCode ?? null
    }));

    return res.json({
      ok: true,
      total,
      available,
      assigned,
      reserved,
      numbers: list
    });
  } catch (err) {
    console.error("[twilio-pool] status error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

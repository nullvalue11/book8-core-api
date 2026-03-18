// src/routes/internalBookings.js
import express from "express";
import { Booking } from "../../models/Booking.js";

const router = express.Router();

// DELETE /internal/bookings/purge-test
// Body: { businessId: string, confirm: true }
router.delete("/purge-test", async (req, res) => {
  try {
    const { businessId, confirm } = req.body || {};

    if (!confirm) {
      return res.status(400).json({
        ok: false,
        error: "Field 'confirm: true' is required to purge test bookings"
      });
    }

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: "Field 'businessId' is required; refusing to purge all bookings"
      });
    }

    const result = await Booking.deleteMany({ businessId });
    const deleted = result?.deletedCount ?? 0;

    console.log("[admin] Purged", deleted, "bookings for businessId", businessId);

    return res.json({
      ok: true,
      deleted
    });
  } catch (err) {
    console.error("Error in DELETE /internal/bookings/purge-test:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;


/**
 * BOO-45A: card setup, cancellation info, save card, mark no-show, charge no-show.
 * Mounted at /api/bookings before the main bookings router (specific paths first).
 */
import express from "express";
import mongoose from "mongoose";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import { Booking } from "../../models/Booking.js";
import { Business } from "../../models/Business.js";
import { Service } from "../../models/Service.js";
import {
  findOrCreateStripeCustomer,
  createCardSetupIntent,
  getStripe
} from "../../services/stripeNoShow.js";
import {
  buildCancellationInfoPayload,
  formatMoneyForLocale,
  resolveCurrency
} from "../../services/noShowProtection.js";
import { tryChargeNoShowFee } from "../../services/bookingFeeCharge.js";
import { sendNoShowChargeEmail } from "../../services/emailService.js";
import rateLimit from "express-rate-limit";

const router = express.Router();

const cardSetupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests, try again later" }
});

function bookingLookupFilter(bookingId) {
  const or = [{ id: bookingId }];
  if (mongoose.isValidObjectId(bookingId)) {
    or.push({ _id: bookingId });
  }
  return { $or: or };
}

/** POST /api/bookings/setup-card */
router.post("/setup-card", cardSetupLimiter, async (req, res) => {
  try {
    const { businessId, customerName, customerEmail, customerPhone } = req.body || {};
    if (!businessId || !customerEmail) {
      return res.status(400).json({
        ok: false,
        error: "businessId and customerEmail are required"
      });
    }
    if (!getStripe()) {
      return res.status(503).json({ ok: false, error: "Card setup is not available" });
    }

    const biz = await Business.findOne({ $or: [{ id: businessId }, { businessId }] }).lean();
    if (!biz) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const cust = await findOrCreateStripeCustomer({
      email: customerEmail,
      name: customerName,
      phone: customerPhone,
      businessId: biz.id ?? biz.businessId
    });
    if (!cust.ok) {
      return res.status(400).json({ ok: false, error: cust.error });
    }

    const si = await createCardSetupIntent({
      stripeCustomerId: cust.customerId,
      businessId: biz.id ?? biz.businessId
    });
    if (!si.ok) {
      return res.status(400).json({ ok: false, error: si.error });
    }

    return res.json({
      ok: true,
      clientSecret: si.clientSecret,
      stripeCustomerId: cust.customerId
    });
  } catch (err) {
    console.error("[setup-card]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** GET /api/bookings/:bookingId/cancellation-info */
router.get("/:bookingId/cancellation-info", strictLimiter, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findOne(bookingLookupFilter(bookingId)).lean();
    if (!booking || booking.status !== "confirmed") {
      return res.status(404).json({ ok: false, error: "Booking not found" });
    }
    const business = await Business.findOne({
      $or: [{ id: booking.businessId }, { businessId: booking.businessId }]
    }).lean();
    if (!business) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }
    const service = await Service.findOne({
      businessId: booking.businessId,
      serviceId: booking.serviceId
    }).lean();

    const info = buildCancellationInfoPayload(booking, business, service);
    return res.json({ ok: true, ...info });
  } catch (err) {
    console.error("[cancellation-info]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** PATCH /api/bookings/:bookingId/save-card */
router.patch("/:bookingId/save-card", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { stripeCustomerId, stripePaymentMethodId, cardLast4, cardBrand } = req.body || {};
    if (!stripeCustomerId || !stripePaymentMethodId) {
      return res.status(400).json({
        ok: false,
        error: "stripeCustomerId and stripePaymentMethodId are required"
      });
    }

    const updated = await Booking.findOneAndUpdate(
      { ...bookingLookupFilter(bookingId), status: "confirmed" },
      {
        $set: {
          stripeCustomerId: String(stripeCustomerId).trim(),
          stripePaymentMethodId: String(stripePaymentMethodId).trim(),
          cardLast4: cardLast4 != null ? String(cardLast4).slice(-4) : undefined,
          cardBrand: cardBrand != null ? String(cardBrand).slice(0, 32) : undefined
        }
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Booking not found or not active" });
    }

    return res.json({ ok: true, booking: updated });
  } catch (err) {
    console.error("[save-card]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** PATCH /api/bookings/:bookingId/mark-no-show */
router.patch("/:bookingId/mark-no-show", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findOne({
      ...bookingLookupFilter(bookingId),
      status: "confirmed"
    });

    if (!booking) {
      return res.status(404).json({ ok: false, error: "Booking not found or not active" });
    }

    const endMs = new Date(booking.slot?.end).getTime();
    if (Number.isNaN(endMs) || endMs > Date.now()) {
      return res.status(400).json({ ok: false, error: "Booking is not in the past yet" });
    }

    const business = await Business.findOne({
      $or: [{ id: booking.businessId }, { businessId: booking.businessId }]
    }).lean();
    const service = await Service.findOne({
      businessId: booking.businessId,
      serviceId: booking.serviceId
    }).lean();

    let chargeResult = null;
    const setDoc = {
      noShow: true,
      noShowMarkedAt: new Date()
    };

    if (business?.noShowProtection?.autoCharge && booking.stripePaymentMethodId) {
      const r = await tryChargeNoShowFee(booking.toObject(), business, service);
      if (!r.ok) {
        return res.status(402).json({ ok: false, error: r.error || "Charge failed" });
      }
      if (r.charged) {
        setDoc.noShowCharged = true;
        setDoc.noShowChargedAt = new Date();
        setDoc.noShowChargeAmount = r.amountMajor;
        setDoc.noShowChargeId = r.paymentIntentId;
        chargeResult = { amount: r.amountMajor, paymentIntentId: r.paymentIntentId };
        if (booking.customer?.email) {
          sendNoShowChargeEmail(
            { ...booking.toObject(), ...setDoc },
            business,
            service || { name: booking.serviceId },
            booking.customer,
            { amountMajor: r.amountMajor }
          ).catch((e) => console.error("[mark-no-show] email:", e.message));
        }
      }
    }

    Object.assign(booking, setDoc);
    await booking.save();

    return res.json({
      ok: true,
      booking: booking.toObject(),
      charge: chargeResult
    });
  } catch (err) {
    console.error("[mark-no-show]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** POST /api/bookings/:bookingId/charge-no-show */
router.post("/:bookingId/charge-no-show", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const booking = await Booking.findOne(bookingLookupFilter(bookingId));

    if (!booking) {
      return res.status(404).json({ ok: false, error: "Booking not found" });
    }
    if (!booking.noShow) {
      return res.status(400).json({ ok: false, error: "Booking is not marked as no-show" });
    }
    if (booking.noShowCharged) {
      return res.status(400).json({ ok: false, error: "No-show fee already charged" });
    }

    const business = await Business.findOne({
      $or: [{ id: booking.businessId }, { businessId: booking.businessId }]
    }).lean();
    const service = await Service.findOne({
      businessId: booking.businessId,
      serviceId: booking.serviceId
    }).lean();

    const r = await tryChargeNoShowFee(booking.toObject(), business, service);
    if (!r.ok) {
      return res.status(402).json({ ok: false, error: r.error || "Charge failed" });
    }
    if (!r.charged) {
      return res.status(400).json({
        ok: false,
        error: r.skipped === "no_card" ? "No saved card on file" : "Nothing to charge"
      });
    }

    booking.noShowCharged = true;
    booking.noShowChargedAt = new Date();
    booking.noShowChargeAmount = r.amountMajor;
    booking.noShowChargeId = r.paymentIntentId;
    await booking.save();

    if (booking.customer?.email) {
      sendNoShowChargeEmail(
        booking.toObject(),
        business,
        service || { name: booking.serviceId },
        booking.customer,
        { amountMajor: r.amountMajor }
      ).catch((e) => console.error("[charge-no-show] email:", e.message));
    }

    const currency = resolveCurrency(business);
    const lang = booking.language || "en";
    return res.json({
      ok: true,
      booking: booking.toObject(),
      charge: {
        amount: r.amountMajor,
        amountFormatted: formatMoneyForLocale(r.amountMajor, currency, lang),
        paymentIntentId: r.paymentIntentId
      }
    });
  } catch (err) {
    console.error("[charge-no-show]", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

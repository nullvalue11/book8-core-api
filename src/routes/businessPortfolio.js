/**
 * BOO-57A: POST/PATCH/DELETE portfolio images (multipart upload, Cloudinary).
 */
import express from "express";
import multer from "multer";
import { randomBytes } from "crypto";
import { Business } from "../../models/Business.js";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import { getPlanFeatures } from "../config/plans.js";
import { isCloudinaryConfigured } from "../../services/businessLogoCloudinary.js";
import { uploadPortfolioImageBuffer, destroyPortfolioImage } from "../../services/businessPortfolioCloudinary.js";

const router = express.Router();

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      const err = new Error("Only PNG, JPG, JPEG, and WEBP images are allowed");
      err.code = "INVALID_IMAGE_TYPE";
      return cb(err);
    }
    cb(null, true);
  }
});

function findBusinessQuery(id) {
  return { $or: [{ id }, { businessId: id }] };
}

function maxPortfolioForPlan(plan) {
  const f = getPlanFeatures(plan);
  const n = f.maxPortfolioPhotos;
  return typeof n === "number" && n > 0 ? n : 5;
}

function generatePortfolioId() {
  const suffix = randomBytes(9).toString("base64url").replace(/[-_]/g, "X").slice(0, 12);
  return `port_${suffix}`;
}

function handleMulterUpload(req, res, next) {
  upload.single("photo")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ ok: false, error: "Image must be 5MB or smaller" });
      }
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (err?.code === "INVALID_IMAGE_TYPE") {
      return res.status(400).json({ ok: false, error: err.message });
    }
    return res.status(400).json({ ok: false, error: err.message || "Upload failed" });
  });
}

/** POST /api/businesses/:id/portfolio — field name: photo */
router.post(
  "/:id/portfolio",
  strictLimiter,
  requireInternalAuth,
  handleMulterUpload,
  async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: 'Missing file field "photo"' });
      }
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({
          ok: false,
          error:
            "Portfolio uploads unavailable — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET"
        });
      }

      const { id } = req.params;
      const doc = await Business.findOne(findBusinessQuery(id));
      if (!doc) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      const plan = doc.plan || "starter";
      const cap = maxPortfolioForPlan(plan);
      const list = Array.isArray(doc.portfolio) ? doc.portfolio : [];
      if (list.length >= cap) {
        return res.status(403).json({
          ok: false,
          error: `Portfolio limit reached (${cap} photos on current plan)`,
          limit: cap
        });
      }

      const portId = generatePortfolioId();
      const businessKey = doc.businessId || doc.id || id;
      const caption =
        typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 200) : "";
      const category =
        typeof req.body?.category === "string" ? req.body.category.trim().slice(0, 64) : "";

      const { secureUrl, publicId } = await uploadPortfolioImageBuffer(
        req.file.buffer,
        businessKey,
        portId
      );

      const maxSo = list.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), -1);
      const item = {
        id: portId,
        url: secureUrl,
        publicId,
        caption: caption || undefined,
        category: category || undefined,
        sortOrder: maxSo + 1,
        createdAt: new Date()
      };

      doc.portfolio = [...list, item];
      await doc.save();

      return res.status(201).json({ ok: true, item, businessId: businessKey });
    } catch (err) {
      console.error("Error in POST /api/businesses/:id/portfolio:", err);
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  }
);

/** PATCH /api/businesses/:id/portfolio/reorder */
router.patch("/:id/portfolio/reorder", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const order = req.body?.order;
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ ok: false, error: "order must be a non-empty array of photo ids" });
    }

    const doc = await Business.findOne(findBusinessQuery(id));
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const list = Array.isArray(doc.portfolio) ? doc.portfolio : [];
    const ids = new Set(list.map((p) => p.id));
    if (order.length !== list.length) {
      return res.status(400).json({ ok: false, error: "order length must match portfolio size" });
    }
    const seen = new Set();
    for (const oid of order) {
      if (typeof oid !== "string" || !ids.has(oid) || seen.has(oid)) {
        return res.status(400).json({ ok: false, error: "invalid or duplicate id in order" });
      }
      seen.add(oid);
    }

    const byId = new Map(list.map((p) => [p.id, p]));
    const reordered = order.map((pid, i) => {
      const p = byId.get(pid);
      const plain = p && typeof p.toObject === "function" ? p.toObject() : { ...p };
      return { ...plain, sortOrder: i };
    });
    doc.portfolio = reordered;
    await doc.save();

    return res.json({ ok: true, portfolio: doc.portfolio });
  } catch (err) {
    console.error("Error in PATCH /api/businesses/:id/portfolio/reorder:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** PATCH /api/businesses/:id/portfolio/:photoId */
router.patch("/:id/portfolio/:photoId", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { id, photoId } = req.params;
    const doc = await Business.findOne(findBusinessQuery(id));
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const list = Array.isArray(doc.portfolio) ? doc.portfolio : [];
    const idx = list.findIndex((p) => p.id === photoId);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: "Photo not found" });
    }

    const { caption, category, sortOrder } = req.body || {};
    const p = list[idx];
    if (caption !== undefined) {
      p.caption =
        typeof caption === "string" && caption.trim() ? caption.trim().slice(0, 200) : undefined;
    }
    if (category !== undefined) {
      p.category =
        typeof category === "string" && category.trim() ? category.trim().slice(0, 64) : undefined;
    }
    if (sortOrder !== undefined) {
      const n = Number(sortOrder);
      if (Number.isFinite(n)) p.sortOrder = n;
    }

    list[idx] = p;
    doc.portfolio = list;
    doc.markModified("portfolio");
    await doc.save();

    return res.json({ ok: true, item: p });
  } catch (err) {
    console.error("Error in PATCH /api/businesses/:id/portfolio/:photoId:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/** DELETE /api/businesses/:id/portfolio/:photoId */
router.delete("/:id/portfolio/:photoId", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { id, photoId } = req.params;
    const doc = await Business.findOne(findBusinessQuery(id));
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const list = Array.isArray(doc.portfolio) ? doc.portfolio : [];
    const item = list.find((p) => p.id === photoId);
    if (!item) {
      return res.status(404).json({ ok: false, error: "Photo not found" });
    }

    if (item.publicId && isCloudinaryConfigured()) {
      await destroyPortfolioImage(item.publicId);
    }

    doc.portfolio = list.filter((p) => p.id !== photoId);
    await doc.save();

    return res.json({ ok: true, businessId: doc.businessId || doc.id });
  } catch (err) {
    console.error("Error in DELETE /api/businesses/:id/portfolio/:photoId:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

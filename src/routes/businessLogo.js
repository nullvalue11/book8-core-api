// src/routes/businessLogo.js — BOO-43A POST/DELETE /api/businesses/:id/logo
import express from "express";
import multer from "multer";
import { Business } from "../../models/Business.js";
import { strictLimiter } from "../middleware/strictLimiter.js";
import { requireInternalAuth } from "../middleware/internalAuth.js";
import {
  isCloudinaryConfigured,
  uploadBusinessLogoBuffer,
  destroyBusinessLogo
} from "../../services/businessLogoCloudinary.js";

const router = express.Router();

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
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

function handleMulterUpload(req, res, next) {
  upload.single("logo")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ ok: false, error: "Logo must be 2MB or smaller" });
      }
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (err?.code === "INVALID_IMAGE_TYPE") {
      return res.status(400).json({ ok: false, error: err.message });
    }
    return res.status(400).json({ ok: false, error: err.message || "Upload failed" });
  });
}

/** POST /api/businesses/:id/logo — multipart field name: logo */
router.post(
  "/:id/logo",
  strictLimiter,
  requireInternalAuth,
  handleMulterUpload,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: "Missing file field \"logo\"" });
      }
      if (!isCloudinaryConfigured()) {
        return res.status(503).json({
          ok: false,
          error:
            "Logo uploads unavailable — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET"
        });
      }

      const doc = await Business.findOne(findBusinessQuery(id));
      if (!doc) {
        return res.status(404).json({ ok: false, error: "Business not found" });
      }

      const businessKey = doc.businessId || doc.id || id;
      const oldPublicId = doc.businessProfile?.logo?.publicId;

      if (oldPublicId) {
        await destroyBusinessLogo(oldPublicId);
      }

      const { secureUrl, publicId } = await uploadBusinessLogoBuffer(req.file.buffer, businessKey);

      doc.businessProfile = doc.businessProfile || {};
      doc.businessProfile.logo = { url: secureUrl, publicId };
      await doc.save();

      return res.status(201).json({
        ok: true,
        logo: { url: secureUrl, publicId },
        businessId: businessKey
      });
    } catch (err) {
      console.error("Error in POST /api/businesses/:id/logo:", err);
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  }
);

router.delete("/:id/logo", strictLimiter, requireInternalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await Business.findOne(findBusinessQuery(id)).lean();
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Business not found" });
    }

    const publicId = doc.businessProfile?.logo?.publicId;
    if (publicId && isCloudinaryConfigured()) {
      await destroyBusinessLogo(publicId);
    }

    await Business.updateOne(findBusinessQuery(id), { $unset: { "businessProfile.logo": 1 } });

    return res.json({ ok: true, businessId: doc.businessId || doc.id });
  } catch (err) {
    console.error("Error in DELETE /api/businesses/:id/logo:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;

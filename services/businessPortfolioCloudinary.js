/**
 * BOO-57A: portfolio images — max 1080×1080 limit crop (aspect preserved).
 */

import { Readable } from "stream";
import { v2 as cloudinary } from "cloudinary";
import { isCloudinaryConfigured } from "./businessLogoCloudinary.js";

function ensureConfigured() {
  if (!isCloudinaryConfigured()) return false;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return true;
}

function safeSegment(s) {
  return String(s || "x")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);
}

/**
 * @param {Buffer} buffer
 * @param {string} businessKey
 * @param {string} portId - portfolio item id (e.g. port_xxx)
 * @returns {Promise<{ secureUrl: string, publicId: string }>}
 */
export async function uploadPortfolioImageBuffer(buffer, businessKey, portId) {
  if (!ensureConfigured()) {
    const err = new Error("Cloudinary is not configured");
    err.code = "CLOUDINARY_NOT_CONFIGURED";
    throw err;
  }

  const biz = safeSegment(businessKey);
  const pid = safeSegment(portId);
  const publicId = `book8/portfolio/${biz}/${pid}`;

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        overwrite: true,
        resource_type: "image",
        transformation: [{ width: 1080, height: 1080, crop: "limit" }]
      },
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }
    );
    Readable.from(buffer).pipe(stream);
  });

  if (!result?.secure_url || !result?.public_id) {
    throw new Error("Cloudinary upload returned no URL");
  }
  return { secureUrl: result.secure_url, publicId: result.public_id };
}

export async function destroyPortfolioImage(publicId) {
  if (!publicId || !ensureConfigured()) return { ok: false, skipped: true };
  try {
    const res = await cloudinary.uploader.destroy(String(publicId), { resource_type: "image" });
    return { ok: res.result === "ok" || res.result === "not found", raw: res };
  } catch (err) {
    console.warn("[businessPortfolioCloudinary] destroy failed:", err.message);
    return { ok: false, error: err.message };
  }
}

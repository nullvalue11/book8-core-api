/**
 * BOO-43A: Upload business logos to Cloudinary (256×256 fill/center).
 */

import { Readable } from "stream";
import { v2 as cloudinary } from "cloudinary";

export function isCloudinaryConfigured() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  return !!(cloud_name && api_key && api_secret);
}

function ensureConfigured() {
  if (!isCloudinaryConfigured()) return false;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  return true;
}

/**
 * @returns {Promise<{ secureUrl: string, publicId: string }>}
 */
export async function uploadBusinessLogoBuffer(buffer, businessKey) {
  if (!ensureConfigured()) {
    const err = new Error("Cloudinary is not configured");
    err.code = "CLOUDINARY_NOT_CONFIGURED";
    throw err;
  }
  const safeId =
    String(businessKey || "logo")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 120) || "logo";

  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "book8/logos",
        public_id: safeId,
        overwrite: true,
        resource_type: "image",
        transformation: [{ width: 256, height: 256, crop: "fill", gravity: "center" }]
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

/**
 * @param {string} publicId - full Cloudinary public_id (e.g. book8/logos/foo)
 */
export async function destroyBusinessLogo(publicId) {
  if (!publicId || !ensureConfigured()) return { ok: false, skipped: true };
  try {
    const res = await cloudinary.uploader.destroy(String(publicId), { resource_type: "image" });
    return { ok: res.result === "ok" || res.result === "not found", raw: res };
  } catch (err) {
    console.warn("[businessLogoCloudinary] destroy failed:", err.message);
    return { ok: false, error: err.message };
  }
}

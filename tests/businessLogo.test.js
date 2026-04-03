/**
 * BOO-43A: business logo upload/delete (Cloudinary when configured).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";

const TEST_ID = "test-business-logo-biz";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";

function internal(req) {
  return req.set("x-book8-internal-secret", INTERNAL_SECRET);
}

describe("Business logo (BOO-43A)", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    await Business.findOneAndUpdate(
      { id: TEST_ID },
      {
        $set: {
          id: TEST_ID,
          name: "Logo Test Co",
          timezone: "America/Toronto",
          businessProfile: {
            phone: "+16135550100"
          }
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Business.deleteOne({ id: TEST_ID });
  });

  it("POST /api/businesses/:id/logo returns 401 without internal auth", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]);
    const res = await request(app)
      .post(`/api/businesses/${TEST_ID}/logo`)
      .attach("logo", png, { filename: "tiny.png", contentType: "image/png" });
    assert.strictEqual(res.status, 401);
  });

  it("POST returns 400 when file field missing", async () => {
    const res = await internal(request(app).post(`/api/businesses/${TEST_ID}/logo`).send({}));
    assert.strictEqual(res.status, 400);
    assert.ok(String(res.body.error || "").includes("logo") || res.body.error);
  });

  it("POST returns 400 for GIF mime type", async () => {
    const res = await internal(
      request(app)
        .post(`/api/businesses/${TEST_ID}/logo`)
        .attach("logo", Buffer.from("GIF89a"), { filename: "x.gif", contentType: "image/gif" })
    );
    assert.strictEqual(res.status, 400);
    assert.ok(String(res.body.error || "").toLowerCase().includes("webp") || String(res.body.error || "").includes("PNG"));
  });

  it("POST returns 400 when file larger than 2MB", async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0);
    const res = await internal(
      request(app)
        .post(`/api/businesses/${TEST_ID}/logo`)
        .attach("logo", big, { filename: "big.png", contentType: "image/png" })
    );
    assert.strictEqual(res.status, 400);
    assert.ok(String(res.body.error || "").toLowerCase().includes("2mb"));
  });

  it("POST returns 503 when Cloudinary is not configured", async () => {
    const hadName = process.env.CLOUDINARY_CLOUD_NAME;
    const hadKey = process.env.CLOUDINARY_API_KEY;
    const hadSecret = process.env.CLOUDINARY_API_SECRET;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]);
    const res = await internal(
      request(app)
        .post(`/api/businesses/${TEST_ID}/logo`)
        .attach("logo", png, { filename: "tiny.png", contentType: "image/png" })
    );
    if (hadName) process.env.CLOUDINARY_CLOUD_NAME = hadName;
    if (hadKey) process.env.CLOUDINARY_API_KEY = hadKey;
    if (hadSecret) process.env.CLOUDINARY_API_SECRET = hadSecret;
    assert.strictEqual(res.status, 503);
    assert.ok(String(res.body.error || "").includes("CLOUDINARY") || res.body.error);
  });

  it("GET /public exposes logo url only (no publicId)", async () => {
    await Business.findOneAndUpdate(
      { id: TEST_ID },
      {
        $set: {
          "businessProfile.logo": {
            url: "https://example.com/logo.png",
            publicId: "book8/logos/secret-id"
          }
        }
      }
    );
    const res = await request(app).get(`/api/businesses/${TEST_ID}/public`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.businessProfile?.logo?.url, "https://example.com/logo.png");
    assert.strictEqual(res.body.businessProfile?.logo?.publicId, undefined);
    await Business.findOneAndUpdate({ id: TEST_ID }, { $unset: { "businessProfile.logo": 1 } });
  });

  it("DELETE /logo clears stored logo without Cloudinary", async () => {
    await Business.findOneAndUpdate(
      { id: TEST_ID },
      {
        $set: {
          "businessProfile.logo": { url: "https://example.com/x.png", publicId: "book8/logos/x" }
        }
      }
    );
    const res = await internal(request(app).delete(`/api/businesses/${TEST_ID}/logo`));
    assert.strictEqual(res.status, 200);
    const doc = await Business.findOne({ id: TEST_ID }).lean();
    assert.strictEqual(doc.businessProfile?.logo, undefined);
  });
});

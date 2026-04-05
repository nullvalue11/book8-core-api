/**
 * BOO-58A: reviews API
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { Review } from "../models/Review.js";
import { signReviewToken } from "../services/reviewToken.js";
import { refreshBusinessReviewStats } from "../services/reviewStats.js";

const TEST_BIZ = "test-reviews-biz";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";
const REVIEW_SECRET = process.env.REVIEW_JWT_SECRET || INTERNAL_SECRET;

const SLOT_PAST = {
  start: "2020-01-01T10:00:00.000Z",
  end: "2020-01-01T11:00:00.000Z",
  timezone: "America/Toronto"
};

describe("Reviews API (BOO-58A)", () => {
  before(async () => {
    process.env.REVIEW_JWT_SECRET = REVIEW_SECRET;
    if (!process.env.INTERNAL_API_SECRET) process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;

    await Business.findOneAndUpdate(
      { id: TEST_BIZ },
      {
        $set: {
          id: TEST_BIZ,
          name: "Review Test Spa",
          timezone: "America/Toronto",
          plan: "growth",
          reviewStats: { averageRating: 0, totalReviews: 0, lastReviewAt: null }
        }
      },
      { upsert: true, new: true }
    );
    await Service.findOneAndUpdate(
      { businessId: TEST_BIZ, serviceId: "svc-massage" },
      {
        $set: {
          businessId: TEST_BIZ,
          serviceId: "svc-massage",
          name: "Massage",
          durationMinutes: 60,
          active: true
        }
      },
      { upsert: true, new: true }
    );
  });

  after(async () => {
    await Review.deleteMany({ businessId: TEST_BIZ });
    await Booking.deleteMany({ businessId: TEST_BIZ });
    await Service.deleteMany({ businessId: TEST_BIZ });
    await Business.deleteOne({ id: TEST_BIZ });
  });

  it("POST /api/reviews saves a published review and updates reviewStats", async () => {
    const bookingId = `bk_review_${Date.now()}`;
    await Booking.create({
      id: bookingId,
      businessId: TEST_BIZ,
      serviceId: "svc-massage",
      customer: { name: "Alex Smith", phone: "+15550001111", email: "a@example.com" },
      slot: SLOT_PAST,
      status: "confirmed",
      language: "en"
    });

    const token = signReviewToken(bookingId, TEST_BIZ);
    const res = await request(app)
      .post("/api/reviews")
      .send({ token, rating: 5, comment: "Great!" });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.review.rating, 5);
    assert.strictEqual(res.body.review.customerName, "Alex");

    const b = await Business.findOne({ id: TEST_BIZ }).lean();
    assert.strictEqual(b.reviewStats.totalReviews, 1);
    assert.strictEqual(b.reviewStats.averageRating, 5);

    await Review.deleteOne({ bookingId });
    await Booking.deleteOne({ id: bookingId });
    await refreshBusinessReviewStats(TEST_BIZ);
  });

  it("rejects duplicate review for same booking", async () => {
    const bookingId = `bk_dup_${Date.now()}`;
    await Booking.create({
      id: bookingId,
      businessId: TEST_BIZ,
      serviceId: "svc-massage",
      customer: { name: "Bo Two", phone: "+15550002222" },
      slot: SLOT_PAST,
      status: "confirmed"
    });
    const token = signReviewToken(bookingId, TEST_BIZ);

    const r1 = await request(app).post("/api/reviews").send({ token, rating: 4, comment: "ok" });
    assert.strictEqual(r1.status, 201);

    const r2 = await request(app).post("/api/reviews").send({ token, rating: 3, comment: "again" });
    assert.strictEqual(r2.status, 409);

    await Review.deleteOne({ bookingId });
    await Booking.deleteOne({ id: bookingId });
    await refreshBusinessReviewStats(TEST_BIZ);
  });

  it("rejects expired token", async () => {
    const bookingId = `bk_exp_${Date.now()}`;
    await Booking.create({
      id: bookingId,
      businessId: TEST_BIZ,
      serviceId: "svc-massage",
      customer: { name: "Cee" },
      slot: SLOT_PAST,
      status: "confirmed"
    });

    const expired = jwt.sign(
      { bookingId, businessId: TEST_BIZ, typ: "review" },
      REVIEW_SECRET,
      { expiresIn: "-1h" }
    );

    const res = await request(app)
      .post("/api/reviews")
      .send({ token: expired, rating: 5, comment: "x" });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.ok, false);

    await Booking.deleteOne({ id: bookingId });
  });

  it("GET /api/businesses/:id/reviews paginates and hides hidden reviews", async () => {
    const bookingId = `bk_list_${Date.now()}`;
    await Booking.create({
      id: bookingId,
      businessId: TEST_BIZ,
      serviceId: "svc-massage",
      customer: { name: "Dee" },
      slot: SLOT_PAST,
      status: "confirmed"
    });
    const token = signReviewToken(bookingId, TEST_BIZ);
    const post = await request(app).post("/api/reviews").send({ token, rating: 5, comment: "visible" });
    assert.strictEqual(post.status, 201);
    const revId = post.body.review.id;

    const get1 = await request(app).get(`/api/businesses/${TEST_BIZ}/reviews?limit=10`);
    assert.strictEqual(get1.status, 200);
    assert.strictEqual(get1.body.ok, true);
    assert.ok(get1.body.totalReviews >= 1);
    assert.ok(Array.isArray(get1.body.reviews));

    const patch = await request(app)
      .patch(`/api/reviews/${revId}/status`)
      .set("x-book8-internal-secret", INTERNAL_SECRET)
      .send({ status: "hidden" });
    assert.strictEqual(patch.status, 200);

    const get2 = await request(app).get(`/api/businesses/${TEST_BIZ}/reviews`);
    assert.ok(!get2.body.reviews.some((r) => r.id === revId));

    await Review.deleteOne({ id: revId });
    await Booking.deleteOne({ id: bookingId });
    await refreshBusinessReviewStats(TEST_BIZ);
  });
});

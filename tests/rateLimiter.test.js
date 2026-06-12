/**
 * BOO-RATELIMIT-CORE-1A — durable Mongo-backed rate limiter
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../index.js";
import { checkRateLimit, ensureRateLimitIndexes } from "../src/lib/rateLimiter.js";
import { RateLimitBucket } from "../models/RateLimitBucket.js";

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "test-internal-secret";
const TEST_NS = "test-rate-limiter";

function internalAuth(req) {
  return req.set("x-book8-internal-secret", INTERNAL_SECRET);
}

async function waitForMongo() {
  if (mongoose.connection.readyState === 1) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MongoDB connection timeout")), 30000);
    if (mongoose.connection.readyState === 1) {
      clearTimeout(timer);
      resolve();
      return;
    }
    mongoose.connection.once("connected", () => {
      clearTimeout(timer);
      resolve();
    });
    mongoose.connection.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("Mongo rate limiter (BOO-RATELIMIT-CORE-1A)", () => {
  before(async () => {
    if (!process.env.INTERNAL_API_SECRET) {
      process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;
    }
    await waitForMongo();
    await ensureRateLimitIndexes();
  });

  after(async () => {
    await RateLimitBucket.deleteMany({ namespace: TEST_NS });
  });

  it("allows up to limit then blocks the next request", async () => {
    const key = `unit-${Date.now()}`;

    for (let i = 1; i <= 5; i++) {
      const result = await checkRateLimit({
        key,
        limit: 5,
        windowSeconds: 60,
        namespace: TEST_NS
      });
      assert.equal(result.allowed, true, `request ${i} should be allowed`);
      assert.equal(result.remaining, 5 - i);
      assert.ok(result.resetAt instanceof Date);
    }

    const blocked = await checkRateLimit({
      key,
      limit: 5,
      windowSeconds: 60,
      namespace: TEST_NS
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
  });

  it("resets after windowSeconds elapses", async () => {
    const key = `reset-${Date.now()}`;

    for (let i = 0; i < 3; i++) {
      await checkRateLimit({
        key,
        limit: 2,
        windowSeconds: 1,
        namespace: TEST_NS
      });
    }

    const blocked = await checkRateLimit({
      key,
      limit: 2,
      windowSeconds: 1,
      namespace: TEST_NS
    });
    assert.equal(blocked.allowed, false);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const afterReset = await checkRateLimit({
      key,
      limit: 2,
      windowSeconds: 1,
      namespace: TEST_NS
    });
    assert.equal(afterReset.allowed, true);
    assert.equal(afterReset.remaining, 1);
  });

  it("has TTL index on resetAt", async () => {
    let ttlIndex;
    for await (const idx of RateLimitBucket.collection.listIndexes()) {
      if (idx.key?.resetAt === 1 && idx.expireAfterSeconds === 0) {
        ttlIndex = idx;
        break;
      }
    }
    assert.ok(ttlIndex, "expected TTL index on resetAt with expireAfterSeconds: 0");
  });

  it("POST /internal/ratelimit/check returns 401 without auth", async () => {
    const res = await request(app).post("/internal/ratelimit/check").send({
      key: "anon",
      limit: 5,
      windowSeconds: 60,
      namespace: TEST_NS
    });
    assert.equal(res.status, 401);
  });

  it("POST /internal/ratelimit/check proxies checkRateLimit", async () => {
    const key = `http-${Date.now()}`;
    const body = { key, limit: 3, windowSeconds: 60, namespace: TEST_NS };

    for (let i = 0; i < 3; i++) {
      const res = await internalAuth(request(app).post("/internal/ratelimit/check").send(body));
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.allowed, true);
    }

    const blocked = await internalAuth(request(app).post("/internal/ratelimit/check").send(body));
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.allowed, false);
    assert.equal(blocked.body.remaining, 0);
    assert.ok(blocked.body.resetAt);
  });
});

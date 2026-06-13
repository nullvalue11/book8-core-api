/**
 * BOO-REVIEW-LINK-2A: review-invite JWT payload matches book8-ai verifier contract (BOO-58B).
 */
import { describe, it, before } from "node:test";
import assert from "node:assert";
import jwt from "jsonwebtoken";
import { signReviewToken, verifyReviewToken } from "../services/reviewToken.js";

const SECRET = "test-review-invite-secret";

describe("review invite token payload (BOO-REVIEW-LINK-2A)", () => {
  before(() => {
    process.env.REVIEW_JWT_SECRET = SECRET;
  });

  it("signs payload with bid, reviewInvite, and bookingId", () => {
    const bookingId = "bk_test123";
    const businessId = "biz_abc";
    const token = signReviewToken(bookingId, businessId);

    const payload = jwt.verify(token, SECRET);
    assert.strictEqual(payload.bookingId, bookingId);
    assert.strictEqual(payload.bid, businessId);
    assert.strictEqual(payload.reviewInvite, true);
    assert.strictEqual(payload.businessId, undefined);
    assert.strictEqual(payload.typ, undefined);
  });

  it("verifyReviewToken accepts the signed payload", () => {
    const token = signReviewToken("bk_v", "biz_v");
    const result = verifyReviewToken(token);
    assert.deepStrictEqual(result, {
      ok: true,
      bookingId: "bk_v",
      businessId: "biz_v"
    });
  });

  it("rejects legacy typ/businessId payload", () => {
    const legacy = jwt.sign(
      { bookingId: "bk_old", businessId: "biz_old", typ: "review" },
      SECRET,
      { expiresIn: "1h" }
    );
    const result = verifyReviewToken(legacy);
    assert.strictEqual(result.ok, false);
  });
});

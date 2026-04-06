/**
 * BOO-74A — public booking slug from business name (not email).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import {
  generateSlug,
  findBusinessByParam,
  generateUniquePublicSlug
} from "../src/utils/businessRouteHelpers.js";

const SLUG_BIZ = "test-boo74-biz-core";
const SLUG_DUP_A = "test-boo74-dup-a";
const SLUG_DUP_B = "test-boo74-dup-b";

void app;

describe("BOO-74A business slug / handle", () => {
  it("generateSlug uses business name rules", () => {
    assert.strictEqual(generateSlug("Diamond Car Wash"), "diamond-car-wash");
    assert.strictEqual(generateSlug("Bright Smile Dental"), "bright-smile-dental");
    assert.strictEqual(generateSlug("Diamond Car Wash Rideau"), "diamond-car-wash-rideau");
    assert.strictEqual(generateSlug("  Spa---Lux  "), "spa-lux");
  });

  it("generateSlug strips underscore (avoids raw email local-part style)", () => {
    assert.strictEqual(generateSlug("user_name_from_email"), "user-name-from-email");
  });

  it("findBusinessByParam resolves public handle", async () => {
    await Business.deleteMany({ id: SLUG_BIZ }).catch(() => {});
    await Business.create({
      id: SLUG_BIZ,
      businessId: SLUG_BIZ,
      name: "Slug Test Shop",
      handle: "slug-test-shop-public",
      phoneNumber: "+16135550997",
      assignedTwilioNumber: "+15559990003"
    });
    const resolved = await findBusinessByParam("slug-test-shop-public");
    assert.ok(resolved);
    assert.strictEqual(resolved.businessId, SLUG_BIZ);
    await Business.deleteMany({ id: SLUG_BIZ });
  });

  it("generateUniquePublicSlug adds numeric suffix when name slug is taken", async () => {
    await Business.deleteMany({ id: { $in: [SLUG_DUP_A, SLUG_DUP_B] } });
    await Business.create({
      id: SLUG_DUP_A,
      businessId: SLUG_DUP_A,
      name: "Same Name Here",
      handle: "same-name-here",
      phoneNumber: "+16135550996",
      assignedTwilioNumber: "+15558880001"
    });
    const next = await generateUniquePublicSlug("Same Name Here", { excludingId: SLUG_DUP_B });
    assert.strictEqual(next, "same-name-here-2");
    await Business.deleteMany({ id: { $in: [SLUG_DUP_A, SLUG_DUP_B] } });
  });
});

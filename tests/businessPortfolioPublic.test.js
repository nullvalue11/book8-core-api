import { describe, it } from "node:test";
import assert from "node:assert";
import { toPublicPortfolio } from "../src/utils/businessPortfolioPublic.js";

describe("toPublicPortfolio (BOO-57A)", () => {
  it("omits publicId and sorts by sortOrder", () => {
    const pub = toPublicPortfolio([
      { id: "a", url: "u1", publicId: "secret", caption: "x", sortOrder: 1 },
      { id: "b", url: "u2", publicId: "s2", sortOrder: 0 }
    ]);
    assert.strictEqual(pub[0].id, "b");
    assert.strictEqual(pub[0].publicId, undefined);
    assert.strictEqual(pub[1].caption, "x");
  });

  it("returns undefined for empty", () => {
    assert.strictEqual(toPublicPortfolio([]), undefined);
    assert.strictEqual(toPublicPortfolio(null), undefined);
  });
});

/**
 * Close MongoDB once after this suite (QA-006). Use with --test-concurrency=1; name sorts last in tests/*.js.
 */
import { describe, it, after } from "node:test";
import mongoose from "mongoose";

describe("zzz database teardown", () => {
  it("noop", () => {});

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });
});

/**
 * BOO-WIZARD-COUNTRY-BRANCH-1A
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import express from "express";
import request from "supertest";
import businessChannelsRouter from "../../src/routes/businessChannels.js";

function channelsApp() {
  const app = express();
  app.use("/api/business", businessChannelsRouter);
  return app;
}

describe("GET /api/business/channels", () => {
  it("returns voiceBlocked for AE", async () => {
    const res = await request(channelsApp()).get("/api/business/channels?country=AE");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.country, "AE");
    assert.deepStrictEqual(res.body.channels, {
      voice: false,
      whatsapp: true,
      sms: false
    });
    assert.strictEqual(res.body.voiceBlocked, true);
    assert.strictEqual(res.body.voiceBlockedReason, "VoIP restrictions in this region");
  });

  it("returns voice allowed for CA", async () => {
    const res = await request(channelsApp()).get("/api/business/channels?country=CA");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.country, "CA");
    assert.deepStrictEqual(res.body.channels, {
      voice: true,
      whatsapp: true,
      sms: true
    });
    assert.strictEqual(res.body.voiceBlocked, false);
    assert.strictEqual(res.body.voiceBlockedReason, undefined);
  });
});

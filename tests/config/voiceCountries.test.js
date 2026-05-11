/**
 * BOO-WIZARD-COUNTRY-BRANCH-1A
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getAvailableChannels,
  isVoiceBlocked,
  isVoiceAllowed
} from "../../src/config/voiceCountries.js";

describe("voiceCountries", () => {
  it("getAvailableChannels(AE) is WhatsApp-only", () => {
    assert.deepStrictEqual(getAvailableChannels("AE"), {
      voice: false,
      whatsapp: true,
      sms: false
    });
  });

  it("getAvailableChannels(CA) is full stack", () => {
    assert.deepStrictEqual(getAvailableChannels("CA"), {
      voice: true,
      whatsapp: true,
      sms: true
    });
  });

  it("getAvailableChannels('') uses conservative defaults", () => {
    assert.deepStrictEqual(getAvailableChannels(""), {
      voice: true,
      whatsapp: true,
      sms: false
    });
  });

  it("isVoiceBlocked(AE)", () => {
    assert.strictEqual(isVoiceBlocked("AE"), true);
  });

  it("isVoiceBlocked(CA)", () => {
    assert.strictEqual(isVoiceBlocked("CA"), false);
  });

  it("isVoiceAllowed unknown stays permissive", () => {
    assert.strictEqual(isVoiceAllowed(""), true);
    assert.strictEqual(isVoiceAllowed(null), true);
  });
});

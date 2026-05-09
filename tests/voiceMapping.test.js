import test from "node:test";
import assert from "node:assert/strict";

import { resolveVoiceIdForBusiness, getDefaultConversationVoiceId } from "../src/config/voiceMapping.js";

test("resolveVoiceIdForBusiness: preferredVoiceLang wins", () => {
  const prevFr = process.env.ELEVENLABS_VOICE_FR_FR;
  const prevAr = process.env.ELEVENLABS_VOICE_AR;
  process.env.ELEVENLABS_VOICE_FR_FR = "voice-fr-prefer";
  process.env.ELEVENLABS_VOICE_AR = "voice-ar-prefer";
  try {
    assert.equal(
      resolveVoiceIdForBusiness({
        preferredVoiceLang: "fr-FR",
        primaryLanguage: "ar"
      }),
      "voice-fr-prefer"
    );
    assert.equal(
      resolveVoiceIdForBusiness({
        preferredVoiceLang: "ar-AE",
        primaryLanguage: "en"
      }),
      "voice-ar-prefer"
    );
  } finally {
    if (prevFr === undefined) delete process.env.ELEVENLABS_VOICE_FR_FR;
    else process.env.ELEVENLABS_VOICE_FR_FR = prevFr;
    if (prevAr === undefined) delete process.env.ELEVENLABS_VOICE_AR;
    else process.env.ELEVENLABS_VOICE_AR = prevAr;
  }
});

test("resolveVoiceIdForBusiness: primaryLanguage maps when no preferredVoiceLang", () => {
  const prevEs = process.env.ELEVENLABS_VOICE_ES_419;
  process.env.ELEVENLABS_VOICE_ES_419 = "voice-es-primary";
  try {
    assert.equal(
      resolveVoiceIdForBusiness({
        primaryLanguage: "es"
      }),
      "voice-es-primary"
    );
  } finally {
    if (prevEs === undefined) delete process.env.ELEVENLABS_VOICE_ES_419;
    else process.env.ELEVENLABS_VOICE_ES_419 = prevEs;
  }
});

test("resolveVoiceIdForBusiness: empty business matches default voice id", () => {
  const prevEn = process.env.ELEVENLABS_VOICE_EN_US;
  const prevDef = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  delete process.env.ELEVENLABS_VOICE_EN_US;
  delete process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  try {
    assert.equal(resolveVoiceIdForBusiness({ primaryLanguage: "en" }), getDefaultConversationVoiceId());
  } finally {
    if (prevEn === undefined) delete process.env.ELEVENLABS_VOICE_EN_US;
    else process.env.ELEVENLABS_VOICE_EN_US = prevEn;
    if (prevDef === undefined) delete process.env.ELEVENLABS_DEFAULT_VOICE_ID;
    else process.env.ELEVENLABS_DEFAULT_VOICE_ID = prevDef;
  }
});

/**
 * BOO-AGENT-VOICE-LOCK-1A — pin one ElevenLabs voice per phone call via conversation-init
 * `conversation_config_override.tts.voice_id`.
 *
 * Requires the ElevenLabs agent Security settings to allow **voice_id** overrides (see ElevenLabs
 * docs: Overrides → enable `tts.voice_id`).
 *
 * Voice IDs default to env vars so ops can swap voices without code deploys. Fallback is Adam
 * (`pNInz6obpgDQGcFmaJgB`), a common multilingual preset — override via ELEVENLABS_DEFAULT_VOICE_ID.
 */

/** @type {string} */
const FALLBACK_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

export function getDefaultConversationVoiceId() {
  return process.env.ELEVENLABS_DEFAULT_VOICE_ID || FALLBACK_VOICE_ID;
}

/** Map short primaryLanguage codes from Business.primaryLanguage → BCP-47-ish keys used below. */
const PRIMARY_LANGUAGE_TO_TAG = {
  en: "en-us",
  fr: "fr-fr",
  es: "es-419",
  ar: "ar",
  de: "de-de",
  it: "it-it",
  pt: "pt-br",
  hi: "hi-in",
  zh: "zh-cn",
  ja: "ja-jp",
  ko: "ko-kr"
};

function normalizeLangTag(raw) {
  if (raw == null || raw === "") return "";
  return String(raw).trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Resolve ElevenLabs voice_id for a business.
 * Precedence: preferredVoiceLang (dashboard) → primaryLanguage → default voice.
 *
 * @param {object|null|undefined} business — lean Business doc from Mongo (may include preferredVoiceLang even before schema migration if stored).
 * @returns {string}
 */
export function resolveVoiceIdForBusiness(business) {
  const voiceTable = buildVoiceTable();

  const preferred = normalizeLangTag(business?.preferredVoiceLang);
  if (preferred) {
    if (voiceTable[preferred]) return voiceTable[preferred];
    const short = preferred.split("-")[0];
    if (PRIMARY_LANGUAGE_TO_TAG[short]) {
      const tag = PRIMARY_LANGUAGE_TO_TAG[short];
      if (voiceTable[tag]) return voiceTable[tag];
    }
    if (voiceTable[short]) return voiceTable[short];
  }

  const pl = normalizeLangTag(business?.primaryLanguage || "en");
  const tag = PRIMARY_LANGUAGE_TO_TAG[pl] || PRIMARY_LANGUAGE_TO_TAG.en;
  if (voiceTable[tag]) return voiceTable[tag];

  return getDefaultConversationVoiceId();
}

function buildVoiceTable() {
  const def = getDefaultConversationVoiceId();
  return {
    "en-us": process.env.ELEVENLABS_VOICE_EN_US || def,
    "en-gb": process.env.ELEVENLABS_VOICE_EN_GB || process.env.ELEVENLABS_VOICE_EN_US || def,
    "fr-fr": process.env.ELEVENLABS_VOICE_FR_FR || def,
    "fr-ca": process.env.ELEVENLABS_VOICE_FR_CA || process.env.ELEVENLABS_VOICE_FR_FR || def,
    "es-419": process.env.ELEVENLABS_VOICE_ES_419 || def,
    "es-es": process.env.ELEVENLABS_VOICE_ES_ES || process.env.ELEVENLABS_VOICE_ES_419 || def,
    ar: process.env.ELEVENLABS_VOICE_AR || def,
    "ar-ae": process.env.ELEVENLABS_VOICE_AR_AE || process.env.ELEVENLABS_VOICE_AR || def,
    "de-de": process.env.ELEVENLABS_VOICE_DE_DE || def,
    "it-it": process.env.ELEVENLABS_VOICE_IT_IT || def,
    "pt-br": process.env.ELEVENLABS_VOICE_PT_BR || def,
    "hi-in": process.env.ELEVENLABS_VOICE_HI_IN || def,
    "zh-cn": process.env.ELEVENLABS_VOICE_ZH_CN || def,
    "ja-jp": process.env.ELEVENLABS_VOICE_JA_JP || def,
    "ko-kr": process.env.ELEVENLABS_VOICE_KO_KR || def
  };
}

/**
 * Merge voice pin into ElevenLabs conversation_config_override (snake_case keys per webhook JSON).
 * @param {object} base — must include `agent.first_message` when applicable
 * @param {string} voiceId
 */
export function withPinnedVoice(base, voiceId) {
  if (!voiceId) return base;
  return {
    ...base,
    tts: {
      ...(base.tts || {}),
      voice_id: voiceId
    }
  };
}

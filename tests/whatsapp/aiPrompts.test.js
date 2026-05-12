import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt } from "../../src/services/whatsapp/aiPrompts.js";

test("buildSystemPrompt includes detect-and-match language instructions (BOO-INFOBIP-AI-MULTILINGUAL-FIX-1A)", () => {
  const prompt = buildSystemPrompt({
    business: { name: "Test Biz", services: [] },
    customer: { name: "A", phone: "+10000000000", language: "en" },
    conversation: { language: "en", messages: [] },
    now: new Date("2020-06-15T16:00:00Z")
  });

  assert.match(prompt, /Detect the language of each customer message/);
  assert.match(prompt, /NEVER tell a customer you/);
  assert.doesNotMatch(prompt, /communicate in English/i);
  assert.doesNotMatch(prompt, /respond in English/i);
  assert.doesNotMatch(prompt, /Respond in the customer's language/i);
  assert.match(prompt, /stored language preference is English/);
});

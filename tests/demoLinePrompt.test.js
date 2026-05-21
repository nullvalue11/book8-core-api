/**
 * BOO-DEMO-PROMPT-OVERRIDE-1A
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_LINE_FIRST_MESSAGE,
  DEMO_LINE_SYSTEM_PROMPT
} from "../src/prompts/demoLinePrompt.js";

describe("demoLinePrompt", () => {
  it("exports non-empty V1 prompt and greeting", () => {
    assert.ok(DEMO_LINE_SYSTEM_PROMPT.includes("TOOL RULES (CRITICAL — READ FIRST)"));
    assert.ok(DEMO_LINE_SYSTEM_PROMPT.includes("tools_disabled_for_demo"));
    assert.ok(DEMO_LINE_SYSTEM_PROMPT.indexOf("TOOL RULES") < DEMO_LINE_SYSTEM_PROMPT.indexOf("Book8 AI demo receptionist"));
    assert.ok(DEMO_LINE_SYSTEM_PROMPT.includes("NEVER invent pricing"));
    assert.ok(DEMO_LINE_FIRST_MESSAGE.includes("Book8 AI demo line"));
  });
});

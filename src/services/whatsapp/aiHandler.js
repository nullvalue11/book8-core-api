// BOO-INFOBIP-AI-HANDLER-1A — async Claude + Infobip reply after inbound WhatsApp
import Anthropic from "@anthropic-ai/sdk";
import mongoose from "mongoose";
import { Business } from "../../../models/Business.js";
import { WhatsappConversation } from "../../models/WhatsappConversation.js";
import { buildSystemPrompt } from "./aiPrompts.js";
import { getToolDefinitions, executeTool } from "./aiTools.js";
import { sendText } from "../../../services/infobip/infobipClient.js";

const MODEL = process.env.ANTHROPIC_MODEL_WHATSAPP || "claude-haiku-4-5-20251001";
const FALLBACK_TEXT = "Sorry, I'm having trouble right now. Please try again in a moment.";

function buildHistoryMessages(conversation) {
  const raw = (conversation.messages || []).slice(-15);
  const history = [];
  for (const m of raw) {
    const t = m.content?.text;
    if (t == null || String(t).trim() === "") continue;
    history.push({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: String(t).trim()
    });
  }
  while (history.length && history[0].role === "assistant") {
    history.shift();
  }
  return history.map((h) => ({ role: h.role, content: h.content }));
}

async function appendOutboundMessage(conversation, { text, meta }) {
  const messageId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  conversation.messages.push({
    messageId,
    direction: "outbound",
    type: "text",
    content: { text },
    meta,
    rawPayload: null,
    createdAt: new Date()
  });
  conversation.lastMessageAt = new Date();
  await conversation.save();
}

/**
 * @param {string|import("mongoose").Types.ObjectId} conversationId
 */
export async function processConversation(conversationId) {
  if (!mongoose.isValidObjectId(String(conversationId))) {
    return;
  }

  const conversation = await WhatsappConversation.findById(conversationId);
  if (!conversation || conversation.businessId === "_unrouted") {
    return;
  }

  if (conversation.windowExpiresAt && new Date() > new Date(conversation.windowExpiresAt)) {
    console.log("[AI-HANDLER] Session window expired — skipping free-form reply");
    return;
  }

  const tenantId = conversation.businessId;
  const business = await Business.findOne({
    $or: [{ id: tenantId }, { businessId: tenantId }]
  }).lean();

  if (!business) {
    console.error("[AI-HANDLER] Business not found for", tenantId);
    return;
  }

  const history = buildHistoryMessages(conversation);
  const systemPrompt = buildSystemPrompt({
    business,
    customer: {
      name: conversation.customerName,
      phone: conversation.customerPhone
    },
    conversation,
    now: new Date()
  });

  const tools = getToolDefinitions();
  const ctx = { business, conversation };

  const toolCallsThisTurn = [];
  const startTime = Date.now();
  let messages = [...history];
  let lastResponse = null;
  let modelError = false;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("[AI-HANDLER] ANTHROPIC_API_KEY is not set — sending fallback only");
    modelError = true;
  } else {
    const client = new Anthropic({ apiKey });
    try {
      for (let iter = 0; iter < 5; iter += 1) {
        lastResponse = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: systemPrompt,
          tools,
          messages
        });

        if (lastResponse.stop_reason !== "tool_use") {
          break;
        }

        const toolUseBlocks = (lastResponse.content || []).filter((b) => b.type === "tool_use");
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (block) => {
            toolCallsThisTurn.push(block.name);
            try {
              const result = await executeTool(block.name, block.input || {}, ctx);
              return {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(result)
              };
            } catch (err) {
              console.error("[AI-HANDLER] Tool exec failed:", block.name, err);
              return {
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify({ success: false, error: err?.message || "error" }),
                is_error: true
              };
            }
          })
        );

        messages = [
          ...messages,
          { role: "assistant", content: lastResponse.content },
          { role: "user", content: toolResults }
        ];
      }
    } catch (err) {
      console.error("[AI-HANDLER] Anthropic error:", err?.message || err);
      modelError = true;
      lastResponse = null;
    }
  }

  let finalText = "";
  let usage = { input_tokens: 0, output_tokens: 0 };

  if (!modelError && lastResponse) {
    usage = lastResponse.usage || usage;
    finalText = (lastResponse.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }

  if (!finalText) {
    if (modelError) {
      finalText = FALLBACK_TEXT;
    } else {
      console.error("[AI-HANDLER] No text response from model");
      return;
    }
  }

  if (process.env.NODE_ENV === "test" && process.env.WHATSAPP_AI_TEST_DRY === "1") {
    const latencyMs = Date.now() - startTime;
    const promptTokens = usage?.input_tokens;
    const completionTokens = usage?.output_tokens;
    const totalTokens = (promptTokens || 0) + (completionTokens || 0);
    await appendOutboundMessage(conversation, {
      text: finalText,
      meta: {
        model: MODEL,
        promptTokens,
        completionTokens,
        totalTokens,
        latencyMs,
        toolCalls: toolCallsThisTurn
      }
    });
    return;
  }

  try {
    await sendText({
      to: conversation.customerPhone,
      text: finalText,
      businessId: business.id
    });
  } catch (err) {
    console.error("[AI-HANDLER] Infobip send failed:", err?.message || err);
    return;
  }

  const latencyMs = Date.now() - startTime;
  const promptTokens = usage?.input_tokens;
  const completionTokens = usage?.output_tokens;
  const totalTokens = (promptTokens || 0) + (completionTokens || 0);

  await appendOutboundMessage(conversation, {
    text: finalText,
    meta: {
      model: MODEL,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
      toolCalls: toolCallsThisTurn
    }
  });

  console.log(
    `[AI-HANDLER] Replied to ${conversation.customerPhone} → ${tenantId} (${toolCallsThisTurn.length} tools, ${latencyMs}ms)`
  );
}

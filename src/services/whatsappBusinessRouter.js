// src/services/whatsappBusinessRouter.js — BOO-INFOBIP-INBOUND-WEBHOOK-1A
import { Business } from "../../models/Business.js";
import { WhatsappConversation } from "../models/WhatsappConversation.js";

const TOKEN_REGEX = /\[BIZ:(biz_[a-z0-9_]+)\]/i;

/**
 * @param {string | undefined} messageText
 * @param {string} customerPhone — E.164
 * @returns {Promise<{ businessId: string, cleanedText: string | undefined }>}
 */
export async function identifyBusiness(messageText, customerPhone) {
  if (messageText) {
    const match = messageText.match(TOKEN_REGEX);
    if (match) {
      const tokenBusinessId = match[1];
      const business = await Business.findOne({
        $or: [{ id: tokenBusinessId }, { businessId: tokenBusinessId }]
      }).lean();
      if (business) {
        return {
          businessId: tokenBusinessId,
          cleanedText: messageText.replace(TOKEN_REGEX, "").trim()
        };
      }
    }
  }

  const existing = await WhatsappConversation.findOne({ customerPhone, status: "active" })
    .sort({ lastMessageAt: -1 })
    .lean();
  if (existing) {
    return { businessId: existing.businessId, cleanedText: messageText };
  }

  return { businessId: "_unrouted", cleanedText: messageText };
}

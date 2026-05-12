/**
 * Infobip WhatsApp REST client (BOO-INFOBIP-INTEGRATE-1A).
 * @see https://www.infobip.com/docs/api/channels/whatsapp
 */
import { randomUUID } from "crypto";
import { Business } from "../../models/Business.js";

function baseUrl() {
  const raw = process.env.INFOBIP_BASE_URL?.trim()?.replace(/\/+$/, "");
  return raw || "";
}

function apiKey() {
  return process.env.INFOBIP_API_KEY?.trim() || "";
}

function assertConfigured() {
  const b = baseUrl();
  const k = apiKey();
  if (!b || !k) {
    throw new Error("Infobip is not configured (INFOBIP_BASE_URL / INFOBIP_API_KEY)");
  }
  return { b, k };
}

async function request(method, path, { body, timeoutMs = 15_000 } = {}) {
  const { b, k } = assertConfigured();
  const url = `${b}${path.startsWith("/") ? path : `/${path}`}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `App ${k}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ac.signal
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(`Infobip HTTP ${res.status}: ${text?.slice(0, 500)}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

/**
 * WhatsApp numbers are typically passed without "+" (digits only).
 * @param {string} e164OrDigits
 */
export function normalizeWhatsAppAddress(e164OrDigits) {
  if (e164OrDigits == null) return "";
  const digits = String(e164OrDigits).replace(/\D/g, "");
  return digits;
}

/**
 * Resolve the WhatsApp sender number for a given business (BOO-INFOBIP-SENDER-FALLBACK-1A).
 * Precedence: 1) business.whatsappSenderNumber 2) process.env.INFOBIP_SENDER
 *
 * @param {object | null} [business] — Business document (lean or hydrated), optional
 * @returns {string} Digits only (no leading +)
 * @throws {Error} if no sender can be resolved
 */
export function resolveWhatsAppSender(business = null) {
  const perBusiness =
    typeof business?.whatsappSenderNumber === "string" ? business.whatsappSenderNumber.trim() : "";
  const envSender = typeof process.env.INFOBIP_SENDER === "string" ? process.env.INFOBIP_SENDER.trim() : "";
  const raw = (perBusiness.length > 0 ? perBusiness : null) || (envSender.length > 0 ? envSender : null);

  if (!raw) {
    throw new Error(
      "No WhatsApp sender configured. Set INFOBIP_SENDER env var OR add whatsappSenderNumber to the business document. " +
        `(business: ${business?.id || business?.businessId || "none"}, envSet: ${envSender.length > 0})`
    );
  }

  const digits = normalizeWhatsAppAddress(raw);
  if (!digits) {
    throw new Error(`WhatsApp sender resolved to empty digits (raw=${JSON.stringify(raw)})`);
  }
  return digits;
}

async function loadBusinessForSender(businessId) {
  if (!businessId || String(businessId).trim() === "") return null;
  const id = String(businessId).trim();
  return Business.findOne({ $or: [{ id }, { businessId: id }] }).lean();
}

/**
 * Send a WhatsApp template message (utility / approved templates).
 * @param {object} params
 * @param {string} [params.from] - Sender (digits); if omitted, resolved via businessId / INFOBIP_SENDER
 * @param {string} params.to - Recipient E.164 or digits
 * @param {string} params.templateName
 * @param {string} params.languageCode - WhatsApp locale (e.g. en_US, ar, fr_FR)
 * @param {string[]} params.placeholders - body placeholders in order
 * @param {string} [params.businessId] - Book8 business id when `from` is omitted
 */
export async function sendWhatsAppTemplate({
  from,
  to,
  templateName,
  languageCode,
  placeholders = [],
  businessId
} = {}) {
  let fromN;
  if (from != null && String(from).trim() !== "") {
    fromN = String(from).trim().replace(/^\+/, "");
    fromN = normalizeWhatsAppAddress(fromN);
  } else {
    const biz = await loadBusinessForSender(businessId);
    fromN = resolveWhatsAppSender(biz);
  }
  if (!fromN) {
    throw new Error(
      "WhatsApp sendWhatsAppTemplate: invalid or empty from (pass from, or businessId with INFOBIP_SENDER / whatsappSenderNumber)"
    );
  }
  const toN = normalizeWhatsAppAddress(to);
  const payload = {
    messages: [
      {
        from: fromN,
        to: toN,
        messageId: randomUUID(),
        content: {
          templateName,
          templateData: {
            body: {
              placeholders: placeholders.map((p) => String(p ?? ""))
            }
          },
          language: languageCode || "en_US"
        }
      }
    ]
  };
  return request("POST", "/whatsapp/1/message/template", { body: payload });
}

/**
 * Free-form session message (24h window). Payload follows Infobip WhatsApp outbound examples.
 * @param {object} params
 * @param {string} params.from
 * @param {string} params.to
 * @param {string} params.text
 */
export async function sendWhatsAppFreeForm({ from, to, text }) {
  // Infobip POST /whatsapp/1/message/text expects a single message object at the
  // root (from, to, messageId, content) — not a `messages`[] wrapper like /template.
  const fromN = normalizeWhatsAppAddress(from);
  const toN = normalizeWhatsAppAddress(to);
  if (!fromN) {
    throw new Error("WhatsApp sendWhatsAppFreeForm: from is required (resolved to empty digits)");
  }
  if (!toN) {
    throw new Error("WhatsApp sendWhatsAppFreeForm: to is required (resolved to empty digits)");
  }
  const requestBody = {
    from: fromN,
    to: toN,
    messageId: randomUUID(),
    content: {
      text: String(text ?? "")
    }
  };
  console.log(
    "[INFOBIP-HTTP] POST /whatsapp/1/message/text body:",
    JSON.stringify(requestBody)
  );
  return request("POST", "/whatsapp/1/message/text", { body: requestBody });
}

/**
 * Session free-form text (24h window). Resolves `from` when omitted (BOO-INFOBIP-SENDER-FALLBACK-1A).
 * @param {{ from?: string, to: string, text: string, businessId?: string }} p
 */
export async function sendText({ from, to, text, businessId } = {}) {
  let sender;
  if (from != null && String(from).trim() !== "") {
    sender = normalizeWhatsAppAddress(String(from).trim().replace(/^\+/, ""));
    if (!sender) {
      throw new Error("WhatsApp sendText: explicit from normalized to empty digits");
    }
  } else {
    const biz = await loadBusinessForSender(businessId);
    sender = resolveWhatsAppSender(biz);
  }

  const recipient = normalizeWhatsAppAddress(to);
  if (!recipient) {
    throw new Error("WhatsApp sendText: recipient (to) is required");
  }

  console.log(
    `[INFOBIP-SEND] from=${sender} to=${recipient} (business=${businessId || "none"}, len=${String(text ?? "").length})`
  );
  return sendWhatsAppFreeForm({ from: sender, to: recipient, text });
}

/** @returns {Promise<object>} */
export async function listSenders() {
  return request("GET", "/whatsapp/2/senders");
}

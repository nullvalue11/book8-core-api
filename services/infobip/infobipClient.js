/**
 * Infobip WhatsApp REST client (BOO-INFOBIP-INTEGRATE-1A).
 * @see https://www.infobip.com/docs/api/channels/whatsapp
 */
import { randomUUID } from "crypto";

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
 * Send a WhatsApp template message (utility / approved templates).
 * @param {object} params
 * @param {string} params.from - Sender (digits)
 * @param {string} params.to - Recipient E.164 or digits
 * @param {string} params.templateName
 * @param {string} params.languageCode - e.g. en, ar, fr, es
 * @param {string[]} params.placeholders - body placeholders in order
 */
export async function sendWhatsAppTemplate({
  from,
  to,
  templateName,
  languageCode,
  placeholders = []
}) {
  const fromN = normalizeWhatsAppAddress(from);
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
          language: languageCode || "en"
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
  const payload = {
    messages: [
      {
        from: normalizeWhatsAppAddress(from),
        to: normalizeWhatsAppAddress(to),
        messageId: randomUUID(),
        content: {
          text: String(text ?? "")
        }
      }
    ]
  };
  return request("POST", "/whatsapp/1/message/text", { body: payload });
}

/** @returns {Promise<object>} */
export async function listSenders() {
  return request("GET", "/whatsapp/2/senders");
}

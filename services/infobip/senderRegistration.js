/**
 * Infobip WhatsApp sender onboarding helpers (BOO-INFOBIP-INTEGRATE-1A).
 * Full Meta verification is partially portal-driven; these helpers wrap list + optional registration kick-off.
 */
import { listSenders, normalizeWhatsAppAddress } from "./infobipClient.js";

/** Map Book8 category strings to something Meta understands (best-effort). */
export function mapCategoryToMetaVertical(category) {
  const c = (category != null ? String(category) : "").toLowerCase().trim();
  if (!c) return "OTHER";
  if (/salon|spa|beauty|nail|hair/.test(c)) return "BEAUTY";
  if (/fitness|gym|yoga|pilates/.test(c)) return "FITNESS";
  if (/dental|dentist|ortho/.test(c)) return "PROF_SERVICES";
  if (/physio|chiro|massage|therapy/.test(c)) return "PROF_SERVICES";
  if (/car_wash|automotive/.test(c)) return "AUTO";
  return "OTHER";
}

/**
 * Find a sender row returned by listSenders().
 * @param {object} sendersResponse - Infobip API JSON
 * @param {string} phoneNumber - E.164 or digits
 */
export function findSenderInList(sendersResponse, phoneNumber) {
  const want = normalizeWhatsAppAddress(phoneNumber);
  const results = sendersResponse?.results || sendersResponse?.senders || [];
  if (!Array.isArray(results)) return null;
  return (
    results.find((s) => {
      const sid = s?.sender ?? s?.phoneNumber ?? s?.number;
      return sid && normalizeWhatsAppAddress(String(sid)) === want;
    }) || null
  );
}

export async function checkSenderStatus(phoneNumber) {
  const senders = await listSenders();
  return findSenderInList(senders, phoneNumber);
}

/**
 * Attempt to initiate sender registration — endpoint/payload may require portal completion.
 * @returns {Promise<object>}
 */
export async function initiateSenderRegistration({
  phoneNumber,
  businessName,
  businessCategory
}) {
  const baseRaw = process.env.INFOBIP_BASE_URL?.trim();
  const key = process.env.INFOBIP_API_KEY?.trim();
  if (!baseRaw || !key) throw new Error("Infobip not configured");

  const payload = {
    phoneNumber: normalizeWhatsAppAddress(phoneNumber),
    profile: {
      name: businessName || "Business",
      vertical: mapCategoryToMetaVertical(businessCategory)
    }
  };

  const base = baseRaw.replace(/\/+$/, "");
  const url = `${base}/whatsapp/2/senders`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `App ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Infobip sender registration failed HTTP ${res.status}: ${text?.slice(0, 400)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

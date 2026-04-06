/**
 * BOO-75A — Format services (with pricing) for ElevenLabs dynamic_variables / voice agent.
 *
 * `services_list` (spoken) and `services_json` (structured) power conversation-init.
 * In the ElevenLabs agent system prompt, tell the model to quote prices from these
 * fields for “how much” questions, use complimentary wording for price 0, and never
 * invent amounts when pricingNote / “confirm pricing” applies.
 */

const CURRENCY_SYMBOL = {
  USD: "$",
  CAD: "CA$",
  EUR: "€",
  GBP: "£"
};

export function currencySymbolForCode(code) {
  const c = (code || "USD").toUpperCase();
  return CURRENCY_SYMBOL[c] || `${c} `;
}

/**
 * @param {object} s - Service doc or embedded shape: serviceId|id, name, durationMinutes|duration, price, currency?
 * @returns {string} One segment for services_list (joined with "; ").
 */
export function formatServiceLineForElevenLabs(s) {
  const name = (s.name && String(s.name).trim()) || "Service";
  const serviceId = s.serviceId || s.id || "";
  const durationRaw = s.durationMinutes != null ? s.durationMinutes : s.duration;
  const duration = durationRaw != null ? Number(durationRaw) : null;
  const durText =
    duration != null && !Number.isNaN(duration) ? `${duration} minutes` : null;

  const priceRaw = s.price;
  let pricePhrase;
  if (priceRaw === null || priceRaw === undefined || priceRaw === "") {
    pricePhrase = "team will confirm pricing";
  } else {
    const n = Number(priceRaw);
    if (Number.isNaN(n)) {
      pricePhrase = "team will confirm pricing";
    } else if (n === 0) {
      pricePhrase = "complimentary free consultation";
    } else {
      const sym = currencySymbolForCode(s.currency);
      const amt = Math.round(n * 100) / 100;
      pricePhrase = `${sym}${amt}`;
    }
  }

  const bits = [name, pricePhrase];
  if (durText) bits.push(durText);
  const core = bits.join(", ");
  return serviceId ? `${core} (serviceId: ${serviceId})` : core;
}

/**
 * @param {Array<object>} services
 */
export function buildServicesListForElevenLabs(services) {
  if (!Array.isArray(services) || services.length === 0) return "appointments";
  return services.map(formatServiceLineForElevenLabs).join("; ");
}

/**
 * Structured copy for services_json (tools / richer context).
 * @param {Array<object>} services
 */
export function buildServicesDetailForElevenLabs(services) {
  if (!Array.isArray(services)) return [];
  return services.map((s) => {
    const serviceId = s.serviceId || s.id;
    const durationRaw = s.durationMinutes != null ? s.durationMinutes : s.duration;
    const durationMinutes =
      durationRaw != null && !Number.isNaN(Number(durationRaw)) ? Number(durationRaw) : undefined;

    const priceRaw = s.price;
    let price = null;
    let pricingNote = null;
    if (priceRaw === null || priceRaw === undefined || priceRaw === "") {
      pricingNote =
        "I can help you book that service, and the team will confirm pricing — do not guess a price.";
    } else {
      const n = Number(priceRaw);
      if (Number.isNaN(n)) {
        pricingNote =
          "I can help you book that service, and the team will confirm pricing — do not guess a price.";
      } else if (n === 0) {
        price = 0;
        pricingNote = "complimentary / free consultation — not zero dollars as a charge.";
      } else {
        price = Math.round(n * 100) / 100;
      }
    }

    const row = {
      serviceId,
      name: s.name,
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      price,
      currency: (s.currency || "USD").toUpperCase()
    };
    if (pricingNote) row.pricingNote = pricingNote;
    return row;
  });
}

/**
 * Map legacy embedded Business.services[] to Service-like objects.
 * @param {object} business - lean business doc
 */
export function embeddedBusinessServicesAsVoiceList(business) {
  const arr = business?.services;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && x.active !== false)
    .map((x) => ({
      serviceId: x.id,
      name: x.name,
      durationMinutes: x.duration,
      price: x.price,
      currency: "USD"
    }));
}

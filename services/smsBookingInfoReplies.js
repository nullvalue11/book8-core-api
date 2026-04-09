/**
 * BOO-84A — SMS informational replies (price / hours / services) without repeating the canned welcome.
 * Optional Gemini when GEMINI_API_KEY is set.
 */

const GEMINI_MODEL = process.env.GEMINI_SMS_MODEL || "gemini-2.0-flash";

function formatMoney(amount, currency) {
  if (amount == null || Number.isNaN(Number(amount))) return "";
  const c = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: c }).format(Number(amount));
  } catch {
    return `${c} ${amount}`;
  }
}

export function tryHeuristicBookingInfoReply(message, business, services) {
  const m = String(message || "").toLowerCase();
  const active = (services || []).filter((s) => s && s.active !== false);

  const listHints =
    /\b(what services|what do you offer|services\?|you offer|menu|packages)\b/i.test(m) ||
    (m.includes("service") && /\b(what|which|list)\b/i.test(m));

  if (listHints) {
    if (active.length === 0) return "We don't have services listed yet. Call or visit our site for details.";
    const names = active.map((s) => s.name).slice(0, 14).join(", ");
    return `${business?.name || "We"}: ${names}. Ask “what’s the price?” or text a service to book.`.slice(
      0,
      480
    );
  }

  const priceHints =
    /\b(price|cost|how much|fee|charge|rate|cheap|expensive|payment)\b/i.test(m) ||
    m.includes("$") ||
    m.includes("€") ||
    m.includes("£");

  if (priceHints) {
    const lines = active.slice(0, 8).map((s) => {
      const p =
        s.price != null && !Number.isNaN(Number(s.price))
          ? formatMoney(s.price, s.currency || "USD")
          : "price on request";
      return `${s.name}: ${p} (${s.durationMinutes} min)`;
    });
    if (lines.length === 0) return "We don't have pricing listed yet — ask us or pick a service to book.";
    const head = `Pricing: `;
    return (head + lines.join(" · ")).slice(0, 480);
  }

  const hoursHints =
    /\b(open|opening|close|closing|hours|when do you|what time)\b/i.test(m) ||
    /\b(available)\b.*\b(today|tomorrow)\b/i.test(m);

  if (hoursHints) {
    const tz = business?.weeklySchedule?.timezone || business?.timezone || "local time";
    const wh = business?.weeklySchedule?.weeklyHours;
    if (wh && typeof wh === "object") {
      const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      const bits = [];
      for (const d of days) {
        const ranges = wh[d];
        if (Array.isArray(ranges) && ranges.length) {
          const r0 = ranges[0];
          const span = r0?.start && r0?.end ? `${r0.start}-${r0.end}` : "?";
          bits.push(`${d.slice(0, 3)} ${span}`);
        }
      }
      if (bits.length) {
        return `Hours (${tz}): ${bits.slice(0, 6).join(", ")}. Text a service name to book.`.slice(0, 480);
      }
    }
    return `We're in ${tz}. Text a service name from our list and we'll find a time.`.slice(0, 480);
  }

  return null;
}

export async function tryGeminiBookingInfoReply(message, business, services) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !message?.trim()) return null;

  const svcSummary = (services || [])
    .filter((s) => s && s.active !== false)
    .slice(0, 24)
    .map((s) => ({
      name: s.name,
      durationMinutes: s.durationMinutes,
      price: s.price,
      currency: s.currency
    }));

  const prompt = `You are SMS support for "${business?.name || "a business"}".
Reply in under 300 characters, plain text, no markdown.
Use the services list for prices when relevant.
Timezone: ${business?.timezone || business?.weeklySchedule?.timezone || "unknown"}.

Services: ${JSON.stringify(svcSummary)}

Customer message: ${message.trim()}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 256, temperature: 0.35 }
      }),
      signal: controller.signal
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("")?.trim();
    if (!text) return null;
    return text.slice(0, 480);
  } catch {
    clearTimeout(t);
    return null;
  }
}

export async function tryAnswerBookingInfoQuestion(message, business, services) {
  const h = tryHeuristicBookingInfoReply(message, business, services);
  if (h) return h;
  return tryGeminiBookingInfoReply(message, business, services);
}

/**
 * Two-way SMS booking: LLM + calendar availability + createBooking (bookingService unchanged).
 */
import OpenAI from "openai";
import { SmsConversation } from "../models/SmsConversation.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { getAvailability } from "./calendarAvailability.js";
import { createBooking } from "./bookingService.js";
import { cancelUpcomingBookingForPhone } from "./smsBookingCancellation.js";

const SMS_CONVO_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 24;

let openaiClient = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export function normalizeE164(phone) {
  return String(phone || "")
    .trim()
    .replace(/\s/g, "");
}

export function getHelpReply(business) {
  const name = business?.name || "us";
  return `Book8 for ${name}: text to book (e.g. "cleaning tomorrow afternoon") or reply CANCEL to cancel an upcoming visit. Questions? Call your booking line.`;
}

export async function getStatusReply(business, customerPhone) {
  const now = new Date().toISOString();
  const booking = await Booking.findOne({
    businessId: business.id,
    "customer.phone": customerPhone,
    status: "confirmed",
    "slot.start": { $gt: now }
  })
    .sort({ "slot.start": 1 })
    .lean();

  if (!booking) {
    return "No upcoming appointments on file for this number.";
  }
  const tz = business.timezone || "America/Toronto";
  const d = new Date(booking.slot.start);
  const when = d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz
  });
  let svc = booking.serviceId;
  try {
    const s = await Service.findOne({ businessId: business.id, serviceId: booking.serviceId }).lean();
    if (s?.name) svc = s.name;
  } catch {
    // keep
  }
  return `Next booking: ${svc} on ${when} (${tz}). Reply CANCEL to cancel.`;
}

function formatDateNice(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return dateStr;
  const d = new Date(dateStr + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function formatTimeShort(iso, timezone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone || "America/Toronto"
  });
}

function dateStrDaysAheadInTimezone(timezone, daysAhead) {
  const base = new Date();
  const shifted = new Date(base.getTime() + daysAhead * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(shifted);
}

/**
 * @param {string} businessId
 * @param {string} serviceId
 * @param {string} dateYmd
 * @param {string} timezone
 */
async function fetchSlotsForDay(businessId, serviceId, dateYmd, timezone) {
  const tz = timezone || "America/Toronto";
  const from = `${dateYmd}T00:00:00`;
  const to = `${dateYmd}T23:59:59`;
  const result = await getAvailability({
    businessId,
    serviceId,
    from,
    to,
    timezone: tz
  });
  if (!result.ok) {
    return { ok: false, error: result.error, slots: [] };
  }
  return { ok: true, slots: result.slots || [], timezone: result.timezone || tz };
}

function pickSlotFromSlots(slots, extracted, timezone) {
  if (extracted?.slotStart && extracted?.slotEnd) {
    return { start: extracted.slotStart, end: extracted.slotEnd };
  }
  const t = (extracted?.time || "").toLowerCase();
  if (!t || !slots?.length) return null;
  for (const s of slots) {
    const label = formatTimeShort(s.start, timezone).toLowerCase().replace(/\s/g, "");
    if (label.includes(t.replace(/\s/g, "")) || t.includes(label.slice(0, 4))) {
      return { start: s.start, end: s.end };
    }
  }
  // try hour match
  const hourMatch = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (hourMatch && slots.length) {
    let h = parseInt(hourMatch[1], 10);
    const m = hourMatch[2] ? parseInt(hourMatch[2], 10) : 0;
    const ap = hourMatch[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    for (const s of slots) {
      const d = new Date(s.start);
      if (d.getHours() === h && Math.abs(d.getMinutes() - m) <= 15) {
        return { start: s.start, end: s.end };
      }
    }
  }
  return slots[0] ? { start: slots[0].start, end: slots[0].end } : null;
}

function buildSystemPrompt(business, services, convo) {
  const tz = business.timezone || business.weeklySchedule?.timezone || "America/Toronto";
  const serviceList = services
    .filter((s) => s.active)
    .map((s) => `- ${s.name} (${s.durationMinutes} min, serviceId: ${s.serviceId})`)
    .join("\n");

  const ctx = convo.context || {};
  const availPreview = ctx.availableSlots
    ? JSON.stringify(
        (ctx.availableSlots || []).slice(0, 8).map((x) => ({
          start: x.start,
          end: x.end,
          label: formatTimeShort(x.start, tz)
        }))
      )
    : "none";

  return `You are a friendly SMS booking assistant for ${business.name}.

SERVICES (use exact serviceId when known):
${serviceList || "(none)"}

BUSINESS TIMEZONE: ${tz}
CURRENT STATE: ${convo.state}
COLLECTED CONTEXT (JSON): ${JSON.stringify(ctx)}
CACHED AVAILABLE SLOTS (if any): ${availPreview}

RULES:
- Keep reply under 300 characters when possible (SMS).
- Respond with a single JSON object ONLY (no markdown), keys:
  "reply": string (required),
  "action": "none" | "check_availability" | "create_booking" | "cancel_booking",
  "extracted": {
    "serviceId": string or null,
    "serviceName": string or null,
    "date": "YYYY-MM-DD" or null,
    "time": "HH:mm 24h or natural" or null,
    "timePreference": "morning"|"afternoon"|"evening"|null,
    "customerName": string or null,
    "customerEmail": string or null,
    "slotStart": ISO string or null,
    "slotEnd": ISO string or null
  },
  "newState": string (greeting|selecting_service|selecting_time|collecting_name|collecting_email|confirming|complete)

When user wants to book: first identify service + date; use action check_availability once you have serviceId and date.
When user picks a time slot, set slotStart/slotEnd from CACHED slots or ask to clarify.
When you have serviceId, slot times, customer name, and email, use action create_booking.
If user wants to cancel, use action cancel_booking.
`;
}

async function runLlm(business, services, convo) {
  const client = getOpenAI();
  if (!client) {
    return null;
  }

  const system = buildSystemPrompt(business, services, convo);
  const history = (convo.messages || []).slice(-MAX_HISTORY).map((m) => ({
    role: m.role === "customer" ? "user" : "assistant",
    content: m.text
  }));

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_SMS_MODEL || "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, ...history]
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

function mergeExtracted(context, extracted) {
  const out = { ...context };
  if (!extracted || typeof extracted !== "object") return out;
  for (const [k, v] of Object.entries(extracted)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

function resolveServiceId(services, extracted) {
  if (extracted?.serviceId && services.some((s) => s.serviceId === extracted.serviceId)) {
    return extracted.serviceId;
  }
  const name = (extracted?.serviceName || "").toLowerCase();
  if (!name) return null;
  const hit = services.find((s) => s.name.toLowerCase().includes(name) || name.includes(s.name.toLowerCase()));
  return hit?.serviceId || null;
}

/**
 * @returns {Promise<string>} SMS reply body
 */
export async function handleSmsBookingMessage(business, customerPhone, messageText) {
  if (process.env.NODE_ENV === "test") {
    return "SMS booking is disabled in test mode.";
  }
  const phone = normalizeE164(customerPhone);
  const bizId = business.id;
  const tz = business.timezone || business.weeklySchedule?.timezone || "America/Toronto";

  let convo = await SmsConversation.findOne({
    businessId: bizId,
    customerPhone: phone,
    expiresAt: { $gt: new Date() }
  });

  if (!convo) {
    convo = new SmsConversation({
      businessId: bizId,
      customerPhone: phone,
      state: "greeting",
      context: {},
      messages: [],
      expiresAt: new Date(Date.now() + SMS_CONVO_TTL_MS)
    });
  }

  convo.messages.push({ role: "customer", text: messageText, timestamp: new Date() });

  const services = await Service.find({ businessId: bizId }).lean();
  const client = getOpenAI();
  if (!client) {
    convo.messages.push({
      role: "assistant",
      text: "SMS booking is not configured (missing OPENAI_API_KEY). Please call us to book.",
      timestamp: new Date()
    });
    convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
    await convo.save();
    return convo.messages[convo.messages.length - 1].text;
  }

  let result;
  try {
    result = await runLlm(business, services, convo);
  } catch (err) {
    console.error("[sms-booking] LLM error:", err.message);
    const reply = "Sorry—something went wrong. Please try again in a moment or call us.";
    convo.messages.push({ role: "assistant", text: reply, timestamp: new Date() });
    convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
    await convo.save();
    return reply;
  }

  const action = result.action || "none";
  let reply = (result.reply || "Okay.").slice(0, 1600);
  if (result.newState) convo.state = result.newState;

  let ctx = mergeExtracted(convo.context || {}, result.extracted);

  if (action === "check_availability") {
    const serviceId = resolveServiceId(services, ctx) || ctx.serviceId;
    let date =
      ctx.date ||
      dateStrDaysAheadInTimezone(tz, 1);
    if (!serviceId) {
      reply = "Which service do you want? Reply with the service name.";
    } else {
      const slotRes = await fetchSlotsForDay(bizId, serviceId, date, tz);
      if (!slotRes.ok) {
        reply = `Can't load times: ${slotRes.error || "try another day"}.`;
      } else {
        ctx.serviceId = serviceId;
        ctx.date = date;
        ctx.availableSlots = slotRes.slots;
        const labels = slotRes.slots.slice(0, 5).map((s) => formatTimeShort(s.start, tz));
        reply =
          labels.length > 0
            ? `Times on ${formatDateNice(date)}: ${labels.join(", ")}. Reply with one, or pick another day.`
            : `No openings on ${formatDateNice(date)}. Try another day?`;
      }
    }
  } else if (action === "create_booking") {
    const serviceId = resolveServiceId(services, ctx) || ctx.serviceId;
    const name = ctx.customerName || result.extracted?.customerName;
    const email = ctx.customerEmail || result.extracted?.customerEmail;
    const slotPick = pickSlotFromSlots(ctx.availableSlots || [], result.extracted || {}, tz);

    if (!serviceId || !name || !email || !slotPick) {
      reply =
        "I need a confirmed time, your name, and email to book. Reply with what's missing.";
    } else {
      const book = await createBooking({
        businessId: bizId,
        serviceId,
        customer: {
          name: String(name).trim(),
          email: String(email).trim(),
          phone
        },
        slot: {
          start: slotPick.start,
          end: slotPick.end,
          timezone: tz
        },
        notes: "Booked via SMS",
        source: "sms-booking"
      });

      if (book.ok) {
        convo.state = "complete";
        const ymd = slotPick.start.includes("T") ? slotPick.start.split("T")[0] : ctx.date;
        reply = `Booked: ${svcName(services, serviceId)} ${formatDateNice(ymd || "")} ${formatTimeShort(slotPick.start, tz)}. Confirmations sent. Reply CANCEL to cancel.`;
      } else {
        reply = book.error || "That slot may be taken—pick another time.";
      }
    }
  } else if (action === "cancel_booking") {
    const cancel = await cancelUpcomingBookingForPhone(business, phone);
    reply = cancel.reply;
  }

  convo.context = ctx;
  convo.messages.push({ role: "assistant", text: reply, timestamp: new Date() });
  convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
  await convo.save();
  return reply;
}

function svcName(services, serviceId) {
  const s = services.find((x) => x.serviceId === serviceId);
  return s?.name || "Appointment";
}

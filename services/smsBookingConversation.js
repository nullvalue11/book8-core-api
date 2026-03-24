/**
 * Two-way SMS booking: default linear state machine (no LLM).
 * Set USE_LLM_SMS=true and OPENAI_API_KEY to use the legacy LLM extraction path.
 */
import OpenAI from "openai";
import { parseDate } from "chrono-node";
import { SmsConversation } from "../models/SmsConversation.js";
import { Service } from "../models/Service.js";
import { Booking } from "../models/Booking.js";
import { getAvailability } from "./calendarAvailability.js";
import { createBooking } from "./bookingService.js";
import { cancelUpcomingBookingForPhone } from "./smsBookingCancellation.js";

const SMS_CONVO_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 24;
const SMS_MODEL = process.env.OPENAI_SMS_MODEL || "gpt-4o-mini";
const LLM_TIMEOUT_MS = 10_000;
const USE_LLM_SMS =
  process.env.USE_LLM_SMS === "true" || process.env.USE_LLM_SMS === "1";

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

/** IANA TZ for SMS copy + slot matching (same order as emailService). */
export function resolveSmsTimezone(business) {
  return (
    business?.weeklySchedule?.timezone ||
    business?.timezone ||
    "America/Toronto"
  );
}

export function getHelpReply(business) {
  const name = business?.name || "us";
  return `Book8 AI for ${name}. Text us to book! Try: "book a cleaning tomorrow at 2pm" or "what's available Friday?" Reply CANCEL to cancel.`;
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
  const tz = resolveSmsTimezone(business);
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

function formatLocalDateYmdFromInstant(instant, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(instant);
}

/** Normalize ordinals / commas so chrono parses "March 23rd, 2026" reliably. */
function normalizeDateTextInput(s) {
  if (!s || typeof s !== "string") return "";
  return s
    .trim()
    .replace(/(\d+)(st|nd|rd|th)\b/gi, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve free-text date to YYYY-MM-DD in the business timezone.
 */
export function resolveDate(dateText, timezone) {
  if (!dateText || typeof dateText !== "string") return null;
  const rawTrim = dateText.trim();
  if (!rawTrim) return null;
  const normalized = normalizeDateTextInput(rawTrim);
  const tz = timezone || "America/Toronto";
  const ref = new Date();
  const tryParse = (text) => {
    try {
      const parsed = parseDate(text, ref, { forwardDate: true });
      if (parsed && !Number.isNaN(parsed.getTime())) {
        return formatLocalDateYmdFromInstant(parsed, tz);
      }
    } catch {
      // fall through
    }
    return null;
  };
  const fromNorm = tryParse(normalized);
  if (fromNorm) return fromNorm;
  if (normalized !== rawTrim) {
    const fromRaw = tryParse(rawTrim);
    if (fromRaw) return fromRaw;
  }
  const lower = normalized.toLowerCase();
  if (lower === "today") {
    return formatLocalDateYmdFromInstant(ref, tz);
  }
  if (lower === "tomorrow") {
    const t = parseDate("tomorrow at 12:00", ref, { forwardDate: true });
    if (t && !Number.isNaN(t.getTime())) {
      return formatLocalDateYmdFromInstant(t, tz);
    }
  }
  return null;
}

/**
 * Parse time phrase to HH:MM (24h), morning|afternoon|evening, or __first_slot__.
 */
export function resolveTime(timeText) {
  if (!timeText || typeof timeText !== "string") return null;
  const lower = timeText.toLowerCase().trim();
  if (!lower) return null;
  if (/^(first|earliest|1\s*st|one)\b/i.test(lower)) return "__first_slot__";
  if (lower.includes("morning") && !/\d/.test(lower)) return "morning";
  if (lower.includes("afternoon") && !/\d/.test(lower)) return "afternoon";
  if (lower.includes("evening") && !/\d/.test(lower)) return "evening";

  const compact = lower.replace(/\s+/g, "");
  const match = compact.match(/^(\d{1,2})(?::(\d{2}))?(a\.?m\.?|p\.?m\.?)?$/i);
  if (match) {
    let hour = parseInt(match[1], 10);
    const min = match[2] ? parseInt(match[2], 10) : 0;
    const ampm = (match[3] || "").replace(/\./g, "").toLowerCase();
    if (ampm.startsWith("p") && hour < 12) hour += 12;
    if (ampm.startsWith("a") && hour === 12) hour = 0;
    if (!ampm && hour >= 0 && hour <= 23) {
      // bare hour like "4" — treat as PM if hour <= 11 for booking context
      if (hour >= 1 && hour <= 11) hour += 12;
    }
    return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  const spaced = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (spaced) {
    let hour = parseInt(spaced[1], 10);
    const min = spaced[2] ? parseInt(spaced[2], 10) : 0;
    const ap = spaced[3].toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  const h24 = lower.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    return `${String(parseInt(h24[1], 10)).padStart(2, "0")}:${String(parseInt(h24[2], 10)).padStart(2, "0")}`;
  }
  return null;
}

function getHourMinuteInTz(isoStart, timezone) {
  const d = new Date(isoStart);
  if (Number.isNaN(d.getTime())) return { h: 0, m: 0 };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return { h, m };
}

/**
 * Match resolved time token to an available slot (business TZ).
 */
export function matchTimeToSlot(timeToken, slots, timezone) {
  if (!timeToken || !slots?.length) return null;
  const tz = timezone || "America/Toronto";
  if (timeToken === "__first_slot__") return slots[0];

  if (timeToken === "morning") {
    return slots.find((s) => getHourMinuteInTz(s.start, tz).h < 12) || null;
  }
  if (timeToken === "afternoon") {
    return (
      slots.find((s) => {
        const { h } = getHourMinuteInTz(s.start, tz);
        return h >= 12 && h < 17;
      }) || null
    );
  }
  if (timeToken === "evening") {
    return (
      slots.find((s) => {
        const { h } = getHourMinuteInTz(s.start, tz);
        return h >= 17 && h < 21;
      }) || null
    );
  }

  const m = timeToken.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const th = parseInt(m[1], 10);
    const tm = parseInt(m[2], 10);
    const want = th * 60 + tm;
    let best = null;
    let bestDiff = Infinity;
    for (const s of slots) {
      const { h, m: sm } = getHourMinuteInTz(s.start, tz);
      const diff = Math.abs(h * 60 + sm - want);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = s;
      }
    }
    if (best && bestDiff <= 30) return best;
  }
  return null;
}

function formatDateNiceYmd(dateYmd, tz) {
  if (!dateYmd || typeof dateYmd !== "string") return String(dateYmd || "");
  const parts = dateYmd.split("-").map((x) => parseInt(x, 10));
  const [y, mo, d] = parts;
  if (!y || !mo || !d) return dateYmd;
  const anchor = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  return anchor.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: tz || "America/Toronto"
  });
}

function formatTimeNice(isoOrDate, tz) {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz || "America/Toronto"
  });
}

function uniqueServiceNames(services) {
  const names = services.filter((s) => s.active !== false).map((s) => s.name);
  return [...new Set(names)];
}

const REPLIES = {
  greeting: (biz, services) => {
    const uniqueNames = uniqueServiceNames(services);
    const list = uniqueNames.length ? uniqueNames.join(", ") : "our services";
    return `Hi! Welcome to ${biz.name}. We offer: ${list}. What would you like to book?`;
  },

  askDate: (service) => {
    const name = service?.name || "That service";
    const dur = service?.durationMinutes;
    return dur
      ? `Great choice! ${name} (${dur} min). What date works for you?`
      : `Great choice! ${name}. What date works for you?`;
  },

  showAvailability: (dateYmd, slots, tz) => {
    const dateStr = formatDateNiceYmd(dateYmd, tz);
    const times = slots.slice(0, 6).map((s) => formatTimeNice(s.start, tz)).join(", ");
    return `Available on ${dateStr}: ${times}. Reply with a time, or pick another day.`;
  },

  noAvailability: (dateYmd, tz) =>
    `Sorry, no availability on ${formatDateNiceYmd(dateYmd, tz)}. Try another day?`,

  confirmSlot: (isoStart, dateYmd, tz) =>
    `Got it, ${formatTimeNice(isoStart, tz)} on ${formatDateNiceYmd(dateYmd, tz)}! What's your name?`,

  askEmail: (name) => `Thanks ${name}! What's your email for the confirmation?`,

  booked: (serviceName, isoStart, dateYmd, tz) =>
    `Booked: ${serviceName} on ${formatDateNiceYmd(dateYmd, tz)} at ${formatTimeNice(
      isoStart,
      tz
    )}. Confirmations sent. Reply CANCEL to cancel.`,

  error: () =>
    `Sorry, I didn't catch that. Try "book a cleaning tomorrow at 2pm" or tell us which day.`,

  help: (biz) =>
    `Book8 AI for ${biz.name}. Text us to book! Try: "book a cleaning tomorrow at 2pm" or "what's available Friday?"`,

  unknownService: (services) => {
    const names = uniqueServiceNames(services);
    return `I didn't find that service. We offer: ${names.join(", ") || "— please call us"}. Which one?`;
  },

  badDate: () =>
    `I couldn't understand that date. Try "tomorrow", "March 24", or "next Monday".`,

  pickFromTimes: (slots, tz) => {
    const times = slots.slice(0, 6).map((s) => formatTimeNice(s.start, tz)).join(", ");
    return `That time isn't available. Choose from: ${times}`;
  },

  needName: () => "What's your name for the booking?",

  needEmail: () => "What's your email for the confirmation?",

  needSlotDetails: () => "I need a confirmed time, your name, and email to book. Reply with what's missing."
};

function activeServices(services) {
  return services.filter((s) => s.active !== false);
}

function matchServiceByText(text, services) {
  if (!text || typeof text !== "string") return null;
  const t = text.toLowerCase().trim();
  const list = activeServices(services);
  const exact = list.find((s) => s.name.toLowerCase() === t);
  if (exact) return exact;
  return (
    list.find(
      (s) =>
        s.name.toLowerCase().includes(t) ||
        t.includes(s.name.toLowerCase()) ||
        s.serviceId.toLowerCase() === t
    ) || null
  );
}

/** One row per distinct service name (first active wins). */
function deduplicateByName(services) {
  const list = activeServices(services);
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const k = s.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function normalizeConversationState(convo) {
  const legacy = { greeting: "selecting_service", init: "selecting_service" };
  if (legacy[convo.state]) convo.state = legacy[convo.state];
}

async function getOrCreateConversation(businessId, customerPhone) {
  const bid = String(businessId ?? "").trim();
  const cp = String(customerPhone ?? "").trim();
  const existing = await SmsConversation.findOne({
    businessId: bid,
    customerPhone: cp,
    expiresAt: { $gt: new Date() }
  });
  if (existing) {
    return { convo: existing, found: true };
  }
  const convo = new SmsConversation({
    businessId: bid,
    customerPhone: cp,
    state: "selecting_service",
    context: {},
    messages: [],
    expiresAt: new Date(Date.now() + SMS_CONVO_TTL_MS)
  });
  return { convo, found: false };
}

async function createSmsBookingFromStateMachine(business, phone, tz, ctx, services) {
  const slot = ctx.selectedSlot;
  if (!slot?.start || !slot?.end || !ctx.serviceId) {
    throw new Error("Missing slot or service");
  }
  const book = await createBooking({
    businessId: business.id,
    serviceId: ctx.serviceId,
    customer: {
      name: ctx.customerName,
      email: ctx.customerEmail,
      phone
    },
    slot: {
      start: slot.start,
      end: slot.end,
      timezone: tz
    },
    notes: "Booked via SMS",
    source: "sms-booking"
  });
  if (!book.ok) {
    throw new Error(book.error || "Booking failed");
  }
  const ymd = slot.start.includes("T") ? slot.start.split("T")[0] : ctx.date;
  const svc = services.find((x) => x.serviceId === ctx.serviceId);
  return REPLIES.booked(svc?.name || "Appointment", slot.start, ymd, tz);
}

/**
 * Linear state machine: service → date → time → name → email. No LLM.
 */
async function handleSmsBookingStateMachine(business, customerPhone, messageText) {
  const phone = normalizeE164(customerPhone);
  const bizId = business.id;
  const tz = resolveSmsTimezone(business);
  const msg = messageText.trim();

  const services = await Service.find({ businessId: bizId }).lean();
  const uniqueServices = deduplicateByName(services);

  const { convo, found: convoFound } = await getOrCreateConversation(bizId, phone);
  console.log("[sms-booking] Loaded convo:", {
    found: convoFound,
    state: convo?.state,
    isNew: convo?.isNew === true,
    serviceId: convo?.context?.serviceId
  });
  normalizeConversationState(convo);

  convo.messages.push({ role: "customer", text: msg, timestamp: new Date() });

  const ctx = convo.context && typeof convo.context === "object" ? convo.context : {};
  convo.context = ctx;

  let reply = "";

  switch (convo.state) {
    case "init":
    case "selecting_service": {
      const matched = matchServiceByText(msg, uniqueServices);
      if (matched) {
        ctx.service = matched.name;
        ctx.serviceId = matched.serviceId;
        ctx.duration = matched.durationMinutes;
        delete ctx.date;
        delete ctx.availableSlots;
        delete ctx.selectedSlot;
        delete ctx.customerName;
        delete ctx.customerEmail;
        reply = `Great choice! ${matched.name} (${matched.durationMinutes} min). What date works for you?`;
        convo.state = "selecting_date";
      } else {
        const names = uniqueServices.map((s) => s.name).join(", ");
        reply = `Hi! Welcome to ${business.name}. We offer: ${names}. What would you like to book?`;
        convo.state = "selecting_service";
      }
      break;
    }

    case "selecting_date": {
      if (!ctx.serviceId) {
        const names = uniqueServices.map((s) => s.name).join(", ");
        reply = `Pick a service first. We offer: ${names}.`;
        convo.state = "selecting_service";
        break;
      }
      const dateStr = resolveDate(msg, tz);
      if (dateStr) {
        ctx.date = dateStr;
        const slotRes = await fetchSlotsForDay(bizId, ctx.serviceId, dateStr, tz);
        if (!slotRes.ok) {
          reply = `Can't load times: ${slotRes.error || "try again later"}.`;
          break;
        }
        const slots = slotRes.slots || [];
        if (slots.length > 0) {
          ctx.availableSlots = slots;
          const times = slots.slice(0, 6).map((s) => formatTimeNice(s.start, tz)).join(", ");
          const dateNice = formatDateNiceYmd(dateStr, tz);
          reply = `Available on ${dateNice}: ${times}. Reply with a time.`;
          convo.state = "selecting_time";
        } else {
          const dateNice = formatDateNiceYmd(dateStr, tz);
          reply = `Sorry, no availability on ${dateNice}. Try another day?`;
        }
      } else {
        reply = `I couldn't understand that date. Try "tomorrow", "March 24", or "next Monday".`;
      }
      break;
    }

    case "selecting_time": {
      if (!ctx.serviceId || !ctx.date) {
        convo.state = !ctx.serviceId ? "selecting_service" : "selecting_date";
        reply = !ctx.serviceId
          ? `Pick a service first. We offer: ${uniqueServices.map((s) => s.name).join(", ")}.`
          : `What date works for you?`;
        break;
      }
      const timeTok = resolveTime(msg);
      if (timeTok && ctx.availableSlots?.length) {
        const slot = matchTimeToSlot(timeTok, ctx.availableSlots, tz);
        if (slot) {
          ctx.selectedSlot = { start: slot.start, end: slot.end };
          const timeNice = formatTimeNice(slot.start, tz);
          const dateNice = formatDateNiceYmd(ctx.date, tz);
          reply = `Got it, ${timeNice} on ${dateNice}! What's your name?`;
          convo.state = "collecting_name";
        } else {
          const times = ctx.availableSlots.slice(0, 6).map((s) => formatTimeNice(s.start, tz)).join(", ");
          reply = `That time isn't available. Choose from: ${times}`;
        }
      } else {
        const newDate = resolveDate(msg, tz);
        if (newDate) {
          ctx.date = newDate;
          const slotRes = await fetchSlotsForDay(bizId, ctx.serviceId, newDate, tz);
          if (!slotRes.ok) {
            reply = `Can't load times: ${slotRes.error || "try again"}.`;
            convo.state = "selecting_date";
            break;
          }
          const slots = slotRes.slots || [];
          if (slots.length > 0) {
            ctx.availableSlots = slots;
            const times = slots.slice(0, 6).map((s) => formatTimeNice(s.start, tz)).join(", ");
            reply = `Available on ${formatDateNiceYmd(newDate, tz)}: ${times}. Reply with a time.`;
            convo.state = "selecting_time";
          } else {
            reply = `No availability on ${formatDateNiceYmd(newDate, tz)}. Try another day?`;
            convo.state = "selecting_date";
          }
        } else {
          const times =
            ctx.availableSlots?.slice(0, 6).map((s) => formatTimeNice(s.start, tz)).join(", ") || "";
          reply = `Reply with a time like "10am" or "2:30 PM". Available: ${times}`;
        }
      }
      break;
    }

    case "collecting_name": {
      const name = msg.trim();
      if (name.length >= 2 && name.length <= 100) {
        ctx.customerName = name;
        reply = `Thanks ${name}! What's your email for the confirmation?`;
        convo.state = "collecting_email";
      } else {
        reply = `What's your name for the booking?`;
      }
      break;
    }

    case "collecting_email": {
      const email = msg.trim().toLowerCase();
      if (looksLikeEmail(email)) {
        ctx.customerEmail = email;
        try {
          reply = await createSmsBookingFromStateMachine(business, phone, tz, ctx, services);
          convo.state = "complete";
          delete ctx.selectedSlot;
          delete ctx.availableSlots;
        } catch (err) {
          console.error("[sms-booking] Booking failed:", err);
          reply = `Sorry, something went wrong creating your booking. Please try again.`;
        }
      } else {
        reply = `That doesn't look like an email. Please enter your email (e.g. john@example.com)`;
      }
      break;
    }

    case "complete": {
      convo.context = {};
      convo.state = "selecting_service";
      const names = uniqueServices.map((s) => s.name).join(", ");
      reply = `Hi again! We offer: ${names}. What would you like to book?`;
      break;
    }

    default: {
      convo.state = "selecting_service";
      const names = uniqueServices.map((s) => s.name).join(", ");
      reply = `Hi! Welcome to ${business.name}. We offer: ${names}. What would you like to book?`;
    }
  }

  convo.messages.push({ role: "assistant", text: reply.slice(0, 1600), timestamp: new Date() });
  convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
  convo.markModified("context");
  await convo.save();
  console.log("[sms-booking] State:", convo.state, "Reply:", reply.substring(0, 80));
  return reply.slice(0, 1600);
}

function buildSystemPrompt(business, services, convo) {
  const serviceNames = activeServices(services)
    .map((s) => s.name)
    .join(", ");

  return `You are parsing SMS messages for a booking system.
Your ONLY job is to understand what the customer wants and extract structured data.
Do NOT generate any customer-facing text. Do NOT format dates or times for display.

Business: ${business.name}
Services offered: ${serviceNames || "(none)"}
Conversation state: ${convo.state}
Already collected: ${JSON.stringify(convo.context || {})}

Return ONLY this JSON (no markdown, no explanation):
{
  "intent": one of: "book", "select_service", "select_date", "select_time",
            "provide_name", "provide_email", "cancel", "help", "greeting",
            "question", "correction", "reschedule", "unclear",
  "extracted": {
    "service": service name mentioned or null,
    "date": date mentioned (any format: "tomorrow", "March 23", "next monday", "03/23") or null,
    "time": time mentioned (any format: "4pm", "4:00", "afternoon", "morning") or null,
    "name": customer name or null,
    "email": email address or null
  }
}

Examples:
- "I want a dental cleaning" → {"intent":"book","extracted":{"service":"dental cleaning"}}
- "Tomorrow at 2pm" → {"intent":"select_date","extracted":{"date":"tomorrow","time":"2pm"}}
- "March 23rd" → {"intent":"select_date","extracted":{"date":"March 23"}}
- "4pm" → {"intent":"select_time","extracted":{"time":"4pm"}}
- "John Smith" → {"intent":"provide_name","extracted":{"name":"John Smith"}}
- "john@email.com" → {"intent":"provide_email","extracted":{"email":"john@email.com"}}
- "cancel" → {"intent":"cancel","extracted":{}}
- "It's Monday not Saturday" → {"intent":"correction","extracted":{"date":"monday"}}`;
}

function safeJsonParse(raw) {
  const s = String(raw || "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(s.slice(start, end + 1));
    }
    throw new Error("Invalid JSON from model");
  }
}

async function extractIntent(business, services, convo, messageText) {
  const client = getOpenAI();
  if (!client) return null;

  const system = buildSystemPrompt(business, services, convo);
  const history = (convo.messages || []).slice(-MAX_HISTORY).map((m) => ({
    role: m.role === "customer" ? "user" : "assistant",
    content: m.text
  }));

  const completion = await client.chat.completions.create({
    model: SMS_MODEL,
    temperature: 0.1,
    max_tokens: 400,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, ...history]
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  const parsed = safeJsonParse(raw);
  if (!parsed.intent) parsed.intent = "unclear";
  if (!parsed.extracted || typeof parsed.extracted !== "object") parsed.extracted = {};
  return parsed;
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

async function showAvailabilityAndReply(bizId, ctx, tz, services) {
  const serviceId = ctx.serviceId;
  const date = ctx.date;
  const svc = activeServices(services).find((s) => s.serviceId === serviceId);
  const slotRes = await fetchSlotsForDay(bizId, serviceId, date, tz);
  if (!slotRes.ok) {
    return {
      reply: `Can't load times: ${slotRes.error || "try another day"}.`,
      state: "selecting_date"
    };
  }
  ctx.availableSlots = slotRes.slots;
  if (!slotRes.slots.length) {
    return { reply: REPLIES.noAvailability(date, tz), state: "selecting_date" };
  }
  return { reply: REPLIES.showAvailability(date, slotRes.slots, tz), state: "selecting_time" };
}

function svcName(services, serviceId) {
  const s = services.find((x) => x.serviceId === serviceId);
  return s?.name || "Appointment";
}

function looksLikeEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

async function completeSmsBooking(bizId, ctx, phone, tz, services) {
  if (!ctx.pendingSlotStart || !ctx.pendingSlotEnd) {
    return { reply: REPLIES.needSlotDetails(), state: "selecting_time", clearSlots: false };
  }
  const book = await createBooking({
    businessId: bizId,
    serviceId: ctx.serviceId,
    customer: {
      name: ctx.customerName,
      email: ctx.customerEmail,
      phone
    },
    slot: {
      start: ctx.pendingSlotStart,
      end: ctx.pendingSlotEnd,
      timezone: tz
    },
    notes: "Booked via SMS",
    source: "sms-booking"
  });

  if (book.ok) {
    const ymd =
      ctx.pendingSlotStart && String(ctx.pendingSlotStart).includes("T")
        ? String(ctx.pendingSlotStart).split("T")[0]
        : ctx.date;
    const reply = REPLIES.booked(svcName(services, ctx.serviceId), ctx.pendingSlotStart, ymd, tz);
    delete ctx.pendingSlotStart;
    delete ctx.pendingSlotEnd;
    return { reply, state: "complete", clearSlots: true };
  }
  delete ctx.pendingSlotStart;
  delete ctx.pendingSlotEnd;
  return {
    reply: book.error || "That slot may be taken—pick another time.",
    state: "selecting_time",
    clearSlots: true
  };
}

/**
 * Delete saved SMS booking conversation and return a fresh greeting (no LLM).
 */
export async function resetAndGreetSmsConversation(business, customerPhone) {
  const phone = normalizeE164(customerPhone);
  const bizId = business.id;
  await SmsConversation.deleteMany({ businessId: bizId, customerPhone: phone });
  const services = await Service.find({ businessId: bizId }).lean();
  const unique = deduplicateByName(services);
  const names = unique.map((s) => s.name).join(", ");
  return `Hi! Welcome to ${business.name}. We offer: ${names}. What would you like to book?`;
}

/**
 * @returns {Promise<string>} SMS reply body
 */
export async function handleSmsBookingMessage(business, customerPhone, messageText) {
  if (process.env.NODE_ENV === "test") {
    return "SMS booking is disabled in test mode.";
  }
  if (USE_LLM_SMS && process.env.OPENAI_API_KEY) {
    return handleSmsBookingMessageWithLlm(business, customerPhone, messageText);
  }
  if (USE_LLM_SMS && !process.env.OPENAI_API_KEY) {
    console.warn(
      "[sms-booking] USE_LLM_SMS is set but OPENAI_API_KEY is missing — using state machine."
    );
  }
  return handleSmsBookingStateMachine(business, customerPhone, messageText);
}

async function handleSmsBookingMessageWithLlm(business, customerPhone, messageText) {
  const phone = normalizeE164(customerPhone);
  const bizId = business.id;
  const tz = resolveSmsTimezone(business);

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

  const msg = messageText.trim();
  convo.messages.push({ role: "customer", text: msg, timestamp: new Date() });

  const services = await Service.find({ businessId: bizId }).lean();
  const client = getOpenAI();
  if (!client) {
    const fail = "SMS booking is not configured (missing OPENAI_API_KEY). Please call us to book.";
    convo.messages.push({ role: "assistant", text: fail, timestamp: new Date() });
    convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
    await convo.save();
    return fail;
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("LLM timeout")), LLM_TIMEOUT_MS)
  );

  const llmStart = Date.now();
  let parsed;
  try {
    parsed = await Promise.race([extractIntent(business, services, convo, msg), timeoutPromise]);
  } catch (err) {
    console.error("[sms-booking] LLM timeout or error:", err.message);
    const reply = REPLIES.greeting(business, services);
    convo.state = "selecting_service";
    convo.messages.push({ role: "assistant", text: reply, timestamp: new Date() });
    convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
    await convo.save();
    console.log("[inbound-sms] LLM response time:", Date.now() - llmStart, "ms");
    return reply;
  }
  console.log("[inbound-sms] LLM response time:", Date.now() - llmStart, "ms");

  const ex = parsed.extracted || {};
  const intent = parsed.intent || "unclear";

  // State-aware heuristics (no customer-facing LLM text)
  if (convo.state === "collecting_name" && !ex.name && msg.length < 120 && !msg.includes("@")) {
    ex.name = msg;
  }
  if (convo.state === "collecting_email" && !ex.email && looksLikeEmail(msg)) {
    ex.email = msg.trim();
  }

  // Stale state: user is picking a service again while we still think we're choosing a time
  if (convo.state === "selecting_time" && intent === "select_service") {
    convo.context = {};
    convo.state = "selecting_service";
  }

  let ctx = { ...(convo.context || {}) };

  if (intent === "correction" || intent === "reschedule") {
    if (ex.date) {
      const r = resolveDate(ex.date, tz);
      if (r) {
        ctx.date = r;
        delete ctx.pendingSlotStart;
        delete ctx.pendingSlotEnd;
        delete ctx.availableSlots;
      }
    }
    if (ex.time) {
      delete ctx.pendingSlotStart;
      delete ctx.pendingSlotEnd;
    }
  }

  if (ex.service) {
    const svc = matchServiceByText(ex.service, services);
    if (svc) {
      const clearStale =
        intent === "select_service" ||
        intent === "book" ||
        (convo.state === "selecting_time" && !!ex.service);
      if (clearStale) {
        ctx.date = null;
        ctx.availableSlots = null;
        delete ctx.pendingSlotStart;
        delete ctx.pendingSlotEnd;
      }
      ctx.serviceId = svc.serviceId;
      ctx.serviceName = svc.name;
      ctx.durationMinutes = svc.durationMinutes;
    }
  }
  if (ex.name) ctx.customerName = String(ex.name).trim();
  if (ex.email && looksLikeEmail(ex.email)) ctx.customerEmail = String(ex.email).trim();

  if (ex.date) {
    const r = resolveDate(ex.date, tz);
    if (r) {
      if (ctx.date !== r) {
        ctx.date = r;
        delete ctx.pendingSlotStart;
        delete ctx.pendingSlotEnd;
        delete ctx.availableSlots;
      }
    }
  }

  console.log(
    "[sms-booking] State:",
    convo.state,
    "Intent:",
    parsed.intent,
    "Extracted:",
    JSON.stringify(parsed.extracted),
    "Context:",
    JSON.stringify(convo.context)
  );
  console.log("[sms-booking] MergedCtx:", JSON.stringify(ctx));

  let reply = "";
  let newState = convo.state;

  // --- cancel ---
  if (intent === "cancel") {
    const cancel = await cancelUpcomingBookingForPhone(business, phone);
    reply = cancel.reply;
    newState = "greeting";
    convo.context = ctx;
    convo.state = newState;
    convo.messages.push({ role: "assistant", text: reply, timestamp: new Date() });
    convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
    await convo.save();
    return reply;
  }

  // --- help ---
  if (intent === "help") {
    reply = REPLIES.help(business);
    newState = convo.state;
    convo.context = ctx;
    convo.state = newState;
    convo.messages.push({ role: "assistant", text: reply, timestamp: new Date() });
    convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
    await convo.save();
    return reply;
  }

  const timeSource = ex.time || (intent === "select_time" ? msg : "");
  const resolvedTimeToken =
    resolveTime(timeSource) ||
    (convo.state === "selecting_time" || ctx.availableSlots?.length ? resolveTime(msg) : null);

  // --- need service ---
  if (!ctx.serviceId) {
    if (ex.date || (convo.state === "selecting_date" && msg)) {
      const dateStr = ex.date || msg;
      const resolvedNoSvc = resolveDate(String(dateStr).trim(), tz);
      if (!resolvedNoSvc) {
        reply = REPLIES.badDate();
        newState = "selecting_service";
      } else {
        reply = `Pick a service first. We offer: ${uniqueServiceNames(services).join(", ")}.`;
        newState = "selecting_service";
      }
    } else if (intent === "greeting" || (intent === "unclear" && !ex.service)) {
      reply = REPLIES.greeting(business, services);
      newState = "selecting_service";
    } else if (ex.service) {
      reply = REPLIES.unknownService(services);
      newState = "selecting_service";
    } else {
      reply = REPLIES.greeting(business, services);
      newState = "selecting_service";
    }
  } else if (!ctx.date) {
    const svcObj = activeServices(services).find((s) => s.serviceId === ctx.serviceId);
    let r = ex.date ? resolveDate(ex.date, tz) : null;
    if (!r && convo.state === "selecting_date" && msg) {
      r = resolveDate(msg, tz);
    }
    const userGaveDate = !!(ex.date || (convo.state === "selecting_date" && msg.trim()));
    if (userGaveDate) {
      if (r) {
        ctx.date = r;
        delete ctx.pendingSlotStart;
        delete ctx.pendingSlotEnd;
        delete ctx.availableSlots;
        const av = await showAvailabilityAndReply(bizId, ctx, tz, services);
        reply = av.reply;
        newState = av.state;
      } else {
        reply = REPLIES.badDate();
        newState = "selecting_date";
      }
    } else {
      reply = REPLIES.askDate(svcObj || { name: ctx.serviceName, durationMinutes: ctx.durationMinutes });
      newState = "selecting_date";
    }
  } else if (!ctx.pendingSlotStart || !ctx.pendingSlotEnd) {
    if (!ctx.availableSlots || ctx.availableSlots.length === 0) {
      const av = await showAvailabilityAndReply(bizId, ctx, tz, services);
      reply = av.reply;
      newState = av.state;
    } else if (resolvedTimeToken) {
      const slot = matchTimeToSlot(resolvedTimeToken, ctx.availableSlots, tz);
      if (slot) {
        ctx.pendingSlotStart = slot.start;
        ctx.pendingSlotEnd = slot.end;
        reply = REPLIES.confirmSlot(slot.start, ctx.date, tz);
        newState = "collecting_name";
      } else if (ex.date && resolveDate(ex.date, tz)) {
        ctx.date = resolveDate(ex.date, tz);
        delete ctx.availableSlots;
        const av = await showAvailabilityAndReply(bizId, ctx, tz, services);
        reply = av.reply;
        newState = av.state;
      } else {
        reply = REPLIES.pickFromTimes(ctx.availableSlots, tz);
        newState = "selecting_time";
      }
    } else if (ex.date) {
      const r = resolveDate(ex.date, tz);
      if (r) {
        ctx.date = r;
        delete ctx.availableSlots;
        const av = await showAvailabilityAndReply(bizId, ctx, tz, services);
        reply = av.reply;
        newState = av.state;
      } else {
        reply = REPLIES.pickFromTimes(ctx.availableSlots, tz);
        newState = "selecting_time";
      }
    } else {
      reply = REPLIES.pickFromTimes(ctx.availableSlots, tz);
      newState = "selecting_time";
    }
  } else if (!ctx.customerName) {
    if (ex.name) {
      ctx.customerName = String(ex.name).trim();
      if (ex.email && looksLikeEmail(ex.email)) {
        ctx.customerEmail = String(ex.email).trim();
        const booked = await completeSmsBooking(bizId, ctx, phone, tz, services);
        reply = booked.reply;
        newState = booked.state;
        if (booked.clearSlots) delete ctx.availableSlots;
      } else {
        reply = REPLIES.askEmail(ctx.customerName);
        newState = "collecting_email";
      }
    } else {
      reply = REPLIES.needName();
      newState = "collecting_name";
    }
  } else if (!ctx.customerEmail || (ex.email && looksLikeEmail(ex.email))) {
    if (ex.email && looksLikeEmail(ex.email)) {
      ctx.customerEmail = String(ex.email).trim();
    }
    if (ctx.customerEmail) {
      const booked = await completeSmsBooking(bizId, ctx, phone, tz, services);
      reply = booked.reply;
      newState = booked.state;
      if (booked.clearSlots) delete ctx.availableSlots;
    } else {
      reply = REPLIES.needEmail();
      newState = "collecting_email";
    }
  } else {
    reply = REPLIES.error();
    newState = convo.state;
  }

  // Same message: service + date + time → after loading slots, pick time immediately
  if (
    newState === "selecting_time" &&
    ctx.availableSlots?.length &&
    resolvedTimeToken &&
    !ctx.pendingSlotStart
  ) {
    const slot = matchTimeToSlot(resolvedTimeToken, ctx.availableSlots, tz);
    if (slot) {
      ctx.pendingSlotStart = slot.start;
      ctx.pendingSlotEnd = slot.end;
      reply = REPLIES.confirmSlot(slot.start, ctx.date, tz);
      newState = "collecting_name";
    }
  }

  convo.context = ctx;
  convo.state = newState;
  convo.messages.push({ role: "assistant", text: reply.slice(0, 1600), timestamp: new Date() });
  convo.expiresAt = new Date(Date.now() + SMS_CONVO_TTL_MS);
  await convo.save();
  return reply.slice(0, 1600);
}

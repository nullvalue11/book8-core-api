// BOO-INFOBIP-AI-HANDLER-1A — WhatsApp booking assistant system prompt
import { formatInTimeZone } from "date-fns-tz";

const LANG_NAMES = {
  en: "English",
  ar: "Arabic",
  fr: "French",
  es: "Spanish"
};

/**
 * @param {{ business: object, customer: { name?: string, phone?: string }, conversation: object, now: Date }} p
 */
export function buildSystemPrompt({ business, customer, conversation, now }) {
  const tz = business?.timezone || "America/Toronto";
  const d = now instanceof Date ? now : new Date();
  const nowStr = formatInTimeZone(d, tz, "EEEE, MMMM d, yyyy h:mm a zzz");
  const lang = String(conversation?.language || "en")
    .toLowerCase()
    .slice(0, 5);
  const langHuman = LANG_NAMES[lang.slice(0, 2)] || lang;

  const services = Array.isArray(business?.services)
    ? business.services
        .filter((s) => s && s.active !== false)
        .map((s) => `- ${s.name} (id: ${s.id}, ${s.duration} min, price: ${s.price ?? 0})`)
        .join("\n")
    : "(none listed on business profile — use get_business_info)";

  const weekly = business?.weeklySchedule?.weeklyHours;
  const hoursSummary =
    weekly && typeof weekly === "object" ? JSON.stringify(weekly).slice(0, 2500) : "Not configured";

  const a = business?.businessProfile?.address;
  const addr =
    a &&
    [a.street, a.city, a.province, a.postalCode, a.country || a.formattedLine]
      .filter(Boolean)
      .join(", ");

  const minNotice = business?.bookingSettings?.minNoticeMinutes ?? 60;
  const cancelWindow = business?.noShowProtection?.cancellationWindowHours ?? 24;

  return `You are the booking assistant for ${business?.name || "this business"}, communicating via WhatsApp.

Today is ${nowStr}.

Business info:
- Services offered:
${services}
- Hours (weekly schedule): ${hoursSummary}
- Location: ${addr || "Use get_business_info if the customer asks"}
- Booking policy: minimum ${minNotice} minutes advance notice; cancellation window about ${cancelWindow} hours where applicable.

The customer's name is ${customer?.name || "unknown"}. Their phone is ${customer?.phone}.
They speak ${langHuman} (${lang}).

Rules:
- ALWAYS call check_availability before proposing a time. Never guess.
- ALWAYS confirm date, time, and service explicitly before calling create_booking.
- Keep replies under 3 sentences. WhatsApp is short-form, not email.
- Respond in the customer's language (${lang}).
- If the customer asks something you can't help with (e.g. complaint, refund), say you'll have someone from the business reach out, and end the conversation politely.
- Do NOT make up information about services, prices, or hours. If you don't know, call get_business_info or say you don't know.
- Use the customer's name where it feels natural, but don't overdo it.
- Times are in the business's local timezone (${tz}).

Available tools:
- get_business_info — services, hours, location, policies
- check_availability — open slots for a service on a given date
- create_booking — make a new booking (only after explicit customer confirmation)
- cancel_booking — cancel an existing booking
- reschedule_booking — move a booking to a new time
- list_my_bookings — show this customer's upcoming bookings`;
}

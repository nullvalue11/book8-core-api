/**
 * "Add to calendar" links for customer confirmation emails (Google, Outlook web, ICS).
 * @param {{ title: string, start: string, end: string, description?: string, location?: string }} params
 * @returns {{ googleUrl: string, outlookUrl: string, icsDataUrl: string }}
 */
export function generateCalendarLinks({ title, start, end, description = "", location = "" }) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { googleUrl: "#", outlookUrl: "#", icsDataUrl: "#" };
  }

  const toGoogleUtc = (d) => {
    const base = d.toISOString().split(".")[0];
    return `${base.replace(/[-:]/g, "")}Z`;
  };

  const googleDates = `${toGoogleUtc(startDate)}/${toGoogleUtc(endDate)}`;
  const googleUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${googleDates}` +
    `&details=${encodeURIComponent(description)}` +
    `&location=${encodeURIComponent(location)}`;

  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();
  const outlookUrl =
    "https://outlook.live.com/calendar/0/action/compose" +
    `?subject=${encodeURIComponent(title)}` +
    `&startdt=${encodeURIComponent(startIso)}` +
    `&enddt=${encodeURIComponent(endIso)}` +
    `&body=${encodeURIComponent(description)}` +
    `&location=${encodeURIComponent(location)}`;

  const icsEscape = (str) =>
    String(str || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");

  const dtStamp = toGoogleUtc(new Date());
  const dtStart = toGoogleUtc(startDate);
  const dtEnd = toGoogleUtc(endDate);

  const icsLines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Book8 AI//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:book8-${dtStamp}-${Math.random().toString(36).slice(2, 10)}@book8.io`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`
  ];
  if (location) {
    icsLines.push(`LOCATION:${icsEscape(location)}`);
  }
  icsLines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  const icsContent = icsLines.join("\r\n");
  const icsDataUrl = `data:text/calendar;charset=utf-8;base64,${Buffer.from(icsContent, "utf8").toString("base64")}`;

  return { googleUrl, outlookUrl, icsDataUrl };
}

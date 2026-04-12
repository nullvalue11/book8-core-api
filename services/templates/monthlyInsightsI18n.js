/**
 * BOO-102A — Monthly insights recap email (EN/FR/ES/AR).
 */
function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function L(lang) {
  const l = (lang || "en").toLowerCase().slice(0, 2);
  if (l === "fr" || l === "es" || l === "ar") return l;
  return "en";
}

const LANG_LABEL = {
  en: { en: "English", fr: "French", es: "Spanish", ar: "Arabic" },
  fr: { en: "anglais", fr: "français", es: "espagnol", ar: "arabe" },
  es: { en: "inglés", fr: "francés", es: "español", ar: "árabe" },
  ar: { en: "الإنجليزية", fr: "الفرنسية", es: "الإسبانية", ar: "العربية" }
};

function formatMoney(amount, currency, lang) {
  const n = typeof amount === "number" ? amount : 0;
  const ccy = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(lang === "ar" ? "ar" : lang === "fr" ? "fr-CA" : lang === "es" ? "es" : "en-US", {
      style: "currency",
      currency: ccy === "CAD" ? "CAD" : "USD",
      maximumFractionDigits: 0
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
}

function languageLines(languageCounts, lang) {
  const labels = LANG_LABEL[L(lang)] || LANG_LABEL.en;
  const entries = Object.entries(languageCounts || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "—";
  return entries
    .map(([code, n]) => {
      const name = labels[code] || code.toUpperCase();
      return `${name} (${n})`;
    })
    .join(", ");
}

/**
 * @param {object} params
 * @param {string} params.firstName
 * @param {string} params.businessName
 * @param {string} params.monthLabel - e.g. "March 2026"
 * @param {object} params.current - computeBusinessInsights result
 * @param {object} params.prior - previous month metrics
 * @param {string} params.insightsUrl
 */
export function buildMonthlyRecapEmail(langRaw, params) {
  const lang = L(langRaw);
  const {
    firstName,
    businessName,
    monthLabel,
    current,
    prior,
    insightsUrl
  } = params;
  const cur = current;
  const bookingsUp = cur.bookingsCount > (prior?.bookingsCount ?? 0);
  const revenueUp = cur.revenue > (prior?.revenue ?? 0);
  const ccy = cur.currency || "USD";

  const subjectTemplates = {
    en: () =>
      `Your Book8 month: ${cur.bookingsCount} bookings, ${formatMoney(cur.revenue, ccy, "en")} booked`,
    fr: () =>
      `Votre mois Book8 : ${cur.bookingsCount} réservations, ${formatMoney(cur.revenue, ccy, "fr")} réservés`,
    es: () =>
      `Tu mes en Book8: ${cur.bookingsCount} citas, ${formatMoney(cur.revenue, ccy, "es")} reservados`,
    ar: () =>
      `شهرك على Book8: ${cur.bookingsCount} حجوزات، ${formatMoney(cur.revenue, ccy, "ar")}`
  };

  const priorBook = prior?.bookingsCount ?? 0;
  const priorRev = prior?.revenue ?? 0;

  const body = {
    en: () => `<p>Hi ${esc(firstName)},</p>
<p>Here's what Book8 did for <strong>${esc(businessName)}</strong> in ${esc(monthLabel)}:</p>
<p style="margin:16px 0;"><strong>📞 ${cur.callsCount} calls handled</strong><br/>
${cur.callsOutsideHours > 0 ? `<span style="color:#444;">${cur.callsOutsideHours} came in outside business hours — you would have missed those without us</span>` : `<span style="color:#444;">Your AI line stayed covered.</span>`}</p>
<p style="margin:16px 0;"><strong>📅 ${cur.bookingsCount} appointments booked</strong><br/>
<span style="color:#444;">${bookingsUp ? `Up from ${priorBook} last month` : priorBook > 0 ? `Compared to ${priorBook} last month` : "Great start this month"}</span></p>
<p style="margin:16px 0;"><strong>💰 ${formatMoney(cur.revenue, ccy, "en")} in services booked</strong><br/>
<span style="color:#444;">${revenueUp ? `Up from ${formatMoney(priorRev, ccy, "en")} last month` : priorRev > 0 ? `Last month: ${formatMoney(priorRev, ccy, "en")}` : ""}</span></p>
<p><strong>🌍 Languages spoken on your line:</strong><br/>${esc(languageLines(cur.languageCounts, "en"))}</p>
${cur.topServices?.length ? `<p><strong>Top services this month:</strong></p><ol>${cur.topServices.map((s, i) => `<li>${esc(s.name)} — ${s.bookingsCount} bookings, ${formatMoney(s.revenue, s.currency || ccy, "en")}</li>`).join("")}</ol>` : ""}
<p style="margin:24px 0;"><a href="${esc(insightsUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View full insights →</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
<p style="font-size:14px;color:#666;">P.S. You can view this report anytime in your dashboard.<br/>You can also turn off these monthly emails in Settings.</p>
<p>— Book8</p>`,
    fr: () => `<p>Bonjour ${esc(firstName)},</p>
<p>Voici ce que Book8 a fait pour <strong>${esc(businessName)}</strong> en ${esc(monthLabel)} :</p>
<p style="margin:16px 0;"><strong>📞 ${cur.callsCount} appels traités</strong><br/>
${cur.callsOutsideHours > 0 ? `<span style="color:#444;">${cur.callsOutsideHours} en dehors des heures d'ouverture</span>` : ""}</p>
<p style="margin:16px 0;"><strong>📅 ${cur.bookingsCount} rendez-vous</strong><br/><span style="color:#444;">${bookingsUp ? `En hausse par rapport à ${priorBook} le mois dernier` : ""}</span></p>
<p style="margin:16px 0;"><strong>💰 ${formatMoney(cur.revenue, ccy, "fr")} de services réservés</strong></p>
<p><strong>🌍 Langues :</strong> ${esc(languageLines(cur.languageCounts, "fr"))}</p>
${cur.topServices?.length ? `<ol>${cur.topServices.map((s) => `<li>${esc(s.name)} — ${s.bookingsCount} · ${formatMoney(s.revenue, s.currency || ccy, "fr")}</li>`).join("")}</ol>` : ""}
<p style="margin:24px 0;"><a href="${esc(insightsUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;">Voir les statistiques →</a></p>
<p style="font-size:14px;color:#666;">Vous pouvez désactiver ces e-mails dans les paramètres.</p>
<p>— Book8</p>`,
    es: () => `<p>Hola ${esc(firstName)},</p>
<p>Esto es lo que Book8 hizo por <strong>${esc(businessName)}</strong> en ${esc(monthLabel)}:</p>
<p><strong>📞 ${cur.callsCount} llamadas</strong></p>
<p><strong>📅 ${cur.bookingsCount} citas</strong></p>
<p><strong>💰 ${formatMoney(cur.revenue, ccy, "es")} en servicios reservados</strong></p>
<p><strong>🌍 Idiomas:</strong> ${esc(languageLines(cur.languageCounts, "es"))}</p>
${cur.topServices?.length ? `<ol>${cur.topServices.map((s) => `<li>${esc(s.name)} — ${s.bookingsCount} · ${formatMoney(s.revenue, s.currency || ccy, "es")}</li>`).join("")}</ol>` : ""}
<p style="margin:24px 0;"><a href="${esc(insightsUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;">Ver estadísticas →</a></p>
<p>— Book8</p>`,
    ar: () => `<p>مرحبًا ${esc(firstName)}،</p>
<p>إليك ما قدّمه Book8 لـ <strong>${esc(businessName)}</strong> في ${esc(monthLabel)}:</p>
<p><strong>📞 ${cur.callsCount} مكالمات</strong></p>
<p><strong>📅 ${cur.bookingsCount} مواعيد</strong></p>
<p><strong>💰 ${formatMoney(cur.revenue, ccy, "ar")} من الخدمات المحجوزة</strong></p>
<p><strong>🌍 اللغات:</strong> ${esc(languageLines(cur.languageCounts, "ar"))}</p>
${cur.topServices?.length ? `<ol>${cur.topServices.map((s) => `<li>${esc(s.name)} — ${s.bookingsCount} · ${formatMoney(s.revenue, s.currency || ccy, "ar")}</li>`).join("")}</ol>` : ""}
<p style="margin:24px 0;"><a href="${esc(insightsUrl)}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;">عرض التحليلات →</a></p>
<p>— Book8</p>`
  };

  const subj = subjectTemplates[lang] ? subjectTemplates[lang]() : subjectTemplates.en();
  const html = body[lang] ? body[lang]() : body.en();
  return { subject: subj, htmlInner: html };
}

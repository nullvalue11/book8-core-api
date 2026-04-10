/**
 * BOO-99A — Multilingual copy for trial expiration drip (EN/FR/ES/AR).
 * HTML fragments only; outer layout applied in emailService.
 */

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} lang */
function L(lang) {
  const l = (lang || "en").toLowerCase().slice(0, 2);
  if (l === "fr" || l === "es" || l === "ar") return l;
  return "en";
}

const COPY = {
  day10: {
    en: (name, b, c, langs) => ({
      subject: "4 days left in your Book8 trial",
      body: `<p>Hi ${esc(name)},</p>
<p>Friendly reminder: you have <strong>4 days left</strong> in your free trial.</p>
<p>Here's what you've built so far:</p>
<ul>
<li><strong>${b}</strong> bookings</li>
<li><strong>${c}</strong> calls handled</li>
<li><strong>${langs}</strong> languages detected on calls</li>
</ul>
<p>Upgrade anytime to keep going — we're cheering you on.</p>`
    }),
    fr: (name, b, c, langs) => ({
      subject: "Il reste 4 jours à votre essai Book8",
      body: `<p>Bonjour ${esc(name)},</p>
<p>Petit rappel : il vous reste <strong>4 jours</strong> d'essai gratuit.</p>
<p>Voici ce que vous avez déjà fait :</p>
<ul>
<li><strong>${b}</strong> réservations</li>
<li><strong>${c}</strong> appels traités</li>
<li><strong>${langs}</strong> langues détectées</li>
</ul>
<p>Passez à un plan quand vous voulez pour continuer.</p>`
    }),
    es: (name, b, c, langs) => ({
      subject: "Quedan 4 días de tu prueba Book8",
      body: `<p>Hola ${esc(name)},</p>
<p>Te recordamos: te quedan <strong>4 días</strong> de prueba gratis.</p>
<p>Esto es lo que has conseguido:</p>
<ul>
<li><strong>${b}</strong> reservas</li>
<li><strong>${c}</strong> llamadas atendidas</li>
<li><strong>${langs}</strong> idiomas detectados</li>
</ul>
<p>Mejora tu plan cuando quieras para seguir.</p>`
    }),
    ar: (name, b, c, langs) => ({
      subject: "متبقي 4 أيام من تجربة Book8",
      body: `<p>مرحبًا ${esc(name)}،</p>
<p>تذكير ودّي: بقيت <strong>4 أيام</strong> في فترة التجربة المجانية.</p>
<p>إليك ما أنجزته حتى الآن:</p>
<ul>
<li><strong>${b}</strong> حجوزات</li>
<li><strong>${c}</strong> مكالمات</li>
<li><strong>${langs}</strong> لغات مكتشفة</li>
</ul>
<p>يمكنك الترقية في أي وقت للمتابعة.</p>`
    })
  },
  day13: {
    en: (name) => ({
      subject: "Your Book8 trial ends tomorrow",
      body: `<p>Hi ${esc(name)},</p>
<p><strong>Your trial ends tomorrow.</strong> Upgrade now to avoid interruption to your booking flow and phone agent.</p>`
    }),
    fr: (name) => ({
      subject: "Votre essai Book8 se termine demain",
      body: `<p>Bonjour ${esc(name)},</p>
<p><strong>Votre essai se termine demain.</strong> Passez à un plan maintenant pour éviter toute interruption.</p>`
    }),
    es: (name) => ({
      subject: "Tu prueba Book8 termina mañana",
      body: `<p>Hola ${esc(name)},</p>
<p><strong>Tu prueba termina mañana.</strong> Mejora ahora para evitar cortes.</p>`
    }),
    ar: (name) => ({
      subject: "تنتهي تجربة Book8 غدًا",
      body: `<p>مرحبًا ${esc(name)}،</p>
<p><strong>تنتهي تجربتك غدًا.</strong> ترقَ الآن لتجنب الانقطاع.</p>`
    })
  },
  day14: {
    en: (name) => ({
      subject: "Your trial ended — grace period started",
      body: `<p>Hi ${esc(name)},</p>
<p>Your Book8 trial has ended. Your <strong>dashboard is read-only</strong>, but your <strong>phone agent stays active for 3 more days</strong>.</p>
<p>Upgrade now to keep full access.</p>`
    }),
    fr: (name) => ({
      subject: "Essai terminé — période de grâce",
      body: `<p>Bonjour ${esc(name)},</p>
<p>Votre essai est terminé. Le <strong>tableau de bord est en lecture seule</strong>, mais votre <strong>agent téléphonique reste actif 3 jours</strong>.</p>
<p>Passez à un plan pour retrouver l'accès complet.</p>`
    }),
    es: (name) => ({
      subject: "Prueba terminada — periodo de gracia",
      body: `<p>Hola ${esc(name)},</p>
<p>Tu prueba terminó. El <strong>panel es solo lectura</strong>, pero tu <strong>agente telefónico sigue 3 días más</strong>.</p>
<p>Mejora ahora para recuperar el acceso completo.</p>`
    }),
    ar: (name) => ({
      subject: "انتهت التجربة — فترة سماح",
      body: `<p>مرحبًا ${esc(name)}،</p>
<p>انتهت تجربتك. <strong>لوحة التحكم للقراءة فقط</strong>، لكن <strong>وكيل الهاتف يبقى نشطًا 3 أيام</strong>.</p>
<p>ترقَ الآن لاستعادة الوصول الكامل.</p>`
    })
  },
  day16: {
    en: (name) => ({
      subject: "Final 24 hours — phone agent pauses tomorrow",
      body: `<p>Hi ${esc(name)},</p>
<p><strong>Final 24 hours.</strong> Tomorrow your phone agent stops answering unless you upgrade.</p>
<p>Your data stays safe — resume anytime.</p>`
    }),
    fr: (name) => ({
      subject: "Dernières 24 h — l'agent téléphonique s'arrête demain",
      body: `<p>Bonjour ${esc(name)},</p>
<p><strong>Dernières 24 heures.</strong> Demain, l'agent téléphonique s'arrête sans mise à niveau.</p>`
    }),
    es: (name) => ({
      subject: "Últimas 24 h — el agente telefónico se detiene mañana",
      body: `<p>Hola ${esc(name)},</p>
<p><strong>Últimas 24 horas.</strong> Mañana el agente deja de responder sin actualización.</p>`
    }),
    ar: (name) => ({
      subject: "24 ساعة أخيرة — يتوقف وكيل الهاتف غدًا",
      body: `<p>مرحبًا ${esc(name)}،</p>
<p><strong>آخر 24 ساعة.</strong> غدًا يتوقف وكيل الهاتف دون ترقية.</p>`
    })
  },
  day17: {
    en: (name) => ({
      subject: "Your Book8 service is paused",
      body: `<p>Hi ${esc(name)},</p>
<p>Your Book8 service is <strong>paused</strong>. Upgrade anytime to resume — your data is safe and waiting for you.</p>`
    }),
    fr: (name) => ({
      subject: "Service Book8 en pause",
      body: `<p>Bonjour ${esc(name)},</p>
<p>Votre service Book8 est <strong>en pause</strong>. Passez à un plan pour reprendre — vos données sont conservées.</p>`
    }),
    es: (name) => ({
      subject: "Tu servicio Book8 está en pausa",
      body: `<p>Hola ${esc(name)},</p>
<p>Tu servicio Book8 está <strong>en pausa</strong>. Mejora cuando quieras para reanudar — tus datos están a salvo.</p>`
    }),
    ar: (name) => ({
      subject: "خدمة Book8 متوقفة",
      body: `<p>مرحبًا ${esc(name)}،</p>
<p>خدمة Book8 <strong>متوقفة</strong>. ترقَ في أي وقت للاستئناف — بياناتك محفوظة.</p>`
    })
  },
  day21: {
    en: (name) => ({
      subject: "We miss you — 20% off your first month",
      body: `<p>Hi ${esc(name)},</p>
<p>We'd love to have you back. Here's <strong>20% off your first month</strong> when you upgrade today.</p>`
    }),
    fr: (name) => ({
      subject: "Vous nous manquez — 20 % sur le premier mois",
      body: `<p>Bonjour ${esc(name)},</p>
<p>Revenez chez Book8 : <strong>20 % sur le premier mois</strong> si vous passez à un plan aujourd'hui.</p>`
    }),
    es: (name) => ({
      subject: "Te echamos de menos — 20 % el primer mes",
      body: `<p>Hola ${esc(name)},</p>
<p>Vuelve con <strong>20 % de descuento el primer mes</strong> al mejorar hoy.</p>`
    }),
    ar: (name) => ({
      subject: "اشتقنا إليك — خصم 20٪ على الشهر الأول",
      body: `<p>مرحبًا ${esc(name)}،</p>
<p>عد إلينا مع <strong>خصم 20٪ على الشهر الأول</strong> عند الترقية اليوم.</p>`
    })
  }
};

export function buildTrialEmailInner(lang, kind, ctx) {
  const l = L(lang);
  const firstName = ctx.firstName || "there";
  const b = ctx.bookings ?? 0;
  const c = ctx.calls ?? 0;
  const langs = ctx.languageCount ?? 1;
  const upgradeUrl = ctx.upgradeUrl || "https://book8.io/upgrade";

  const table = COPY[kind];
  if (!table) return { subject: "Book8 trial", body: "<p>Reminder from Book8.</p>" };
  const fn = table[l] || table.en;
  const out = kind === "day10" ? fn(firstName, b, c, langs) : fn(firstName);
  const utm = esc(upgradeUrl);
  const cta = `<p style="margin-top:24px;"><a href="${utm}" style="display:inline-block;background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Upgrade to Growth — $99/mo</a></p>`;
  return { subject: out.subject, body: out.body + cta };
}

/** SMS under ~160 chars; upgrade URL should be short (use book8.io path) */
export function trialSmsText(lang, kind, upgradeShortUrl) {
  const l = L(lang);
  const u = upgradeShortUrl || "https://book8.io/upgrade";
  const S = {
    day14: {
      en: `Book8: Trial ended — dashboard read-only; phone agent active 3d. Upgrade: ${u}`,
      fr: `Book8: Essai fini — tableau lecture seule; agent actif 3j. ${u}`,
      es: `Book8: Prueba fina — panel solo lectura; agente 3d. ${u}`,
      ar: `Book8: انتهت التجربة. ترقَ: ${u}`
    },
    day15: {
      en: `Book8: 2 days until phone agent pauses. Upgrade: ${u}`,
      fr: `Book8: 2 jours avant pause agent. ${u}`,
      es: `Book8: 2 días para pausa del agente. ${u}`,
      ar: `Book8: يومان حتى يتوقف الوكيل. ${u}`
    },
    day16: {
      en: `Book8: Final 24h — phone stops tomorrow. Upgrade: ${u}`,
      fr: `Book8: Dernières 24h — arrêt demain. ${u}`,
      es: `Book8: Últimas 24h — corta mañana. ${u}`,
      ar: `Book8: 24س أخيرة — يتوقف غدًا. ${u}`
    }
  };
  const row = S[kind];
  if (!row) return `Book8: ${u}`;
  return row[l] || row.en;
}

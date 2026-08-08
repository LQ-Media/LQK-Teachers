// Presentation helpers shared by the builder preview, the public invite page
// and the email renderer, so an event reads identically in all three.
//
// Event times are stored as a bare 'YYYY-MM-DDTHH:MM' wall-clock string, not a
// UTC instant. That is deliberate: an event at "10am at Woods Square" is 10am
// in Singapore regardless of where the parent's phone thinks it is, and
// round-tripping through UTC is exactly how a 10am event becomes 6pm for a
// parent travelling abroad.

const LOCALE = { en: "en-SG", ms: "ms-MY" };

function parseLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(value || "").trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  return {
    date: new Date(Number(y), Number(mo) - 1, Number(d), Number(hh || 0), Number(mm || 0)),
    hasTime: hh !== undefined,
  };
}

export function formatEventDate(value, language = "en") {
  const parsed = parseLocal(value);
  if (!parsed) return "";
  return parsed.date.toLocaleDateString(LOCALE[language] || LOCALE.en, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatEventTime(value, language = "en") {
  const parsed = parseLocal(value);
  if (!parsed || !parsed.hasTime) return "";
  return parsed.date.toLocaleTimeString(LOCALE[language] || LOCALE.en, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// "Saturday, 12 September 2026 · 10:00 am – 12:30 pm"
export function formatWhen(startsAt, endsAt, language = "en") {
  const date = formatEventDate(startsAt, language);
  if (!date) return "";
  const from = formatEventTime(startsAt, language);
  const to = formatEventTime(endsAt, language);
  if (!from) return date;
  return `${date} · ${from}${to ? ` – ${to}` : ""}`;
}

// Compact form for the WhatsApp template, where every character counts.
export function formatWhenShort(startsAt, language = "en") {
  const parsed = parseLocal(startsAt);
  if (!parsed) return "";
  const date = parsed.date.toLocaleDateString(LOCALE[language] || LOCALE.en, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = formatEventTime(startsAt, language);
  return time ? `${date}, ${time}` : date;
}

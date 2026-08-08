// Presentation helpers shared by the builder preview, the public invite page
// and the email renderer, so an event reads identically in all three.
//
// Event times are stored as a bare 'YYYY-MM-DDTHH:MM' wall-clock string, not a
// UTC instant. That is deliberate: an event at "10am at Woods Square" is 10am
// in Singapore regardless of where the parent's phone thinks it is, and
// round-tripping through UTC is exactly how a 10am event becomes 6pm for a
// parent travelling abroad.

// Singapore variants where they exist, so month and weekday names match how
// they are written locally.
//
// Arabic is pinned to Latin digits (`-u-nu-latn`). The default Arabic numbering
// system renders dates in Arabic-Indic digits (١٢), which is correct Arabic but
// reads as a different date from the venue address, phone number and everything
// else on the invite — those stay in Latin digits. One numeral system per
// invite beats authenticity here.
const LOCALE = {
  en: "en-SG",
  ms: "ms-MY",
  zh: "zh-SG",
  ta: "ta-SG",
  ar: "ar-u-nu-latn",
};

function parseLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(value || "").trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  return {
    date: new Date(Number(y), Number(mo) - 1, Number(d), Number(hh || 0), Number(mm || 0)),
    hasTime: hh !== undefined,
  };
}

// Intl output can contain a narrow no-break space (U+202F) before am/pm in
// some builds and a plain space in others. Flatten both so the same date never
// compares unequal to itself across environments.
function normalizeSpaces(value) {
  return String(value).replace(/[\u202f\u00a0]/g, " ");
}

export function formatEventDate(value, language = "en") {
  const parsed = parseLocal(value);
  if (!parsed) return "";
  return normalizeSpaces(
    parsed.date.toLocaleDateString(LOCALE[language] || LOCALE.en, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  );
}

/**
 * Time of day, assembled from parts rather than taken from Intl whole.
 *
 * The locale supplies the am/pm wording; WE decide the order. That is not
 * pedantry: Node's ICU renders Tamil as "10:00 AM" and Chrome's as "AM 10:00",
 * and this string is rendered in three places that must agree — the email
 * (Node), the invite page (server-rendered then hydrated in the browser) and
 * the builder's live preview (browser). Letting each runtime pick its own
 * order produced a React hydration error and, worse, meant a parent's email
 * could state the time differently from the page it linked to.
 *
 * The cost is that Tamil reads "10:00 AM" rather than the CLDR-preferred
 * "AM 10:00". Unambiguous either way, and worth it for one time per invite.
 */
export function formatEventTime(value, language = "en") {
  const parsed = parseLocal(value);
  if (!parsed || !parsed.hasTime) return "";

  const parts = new Intl.DateTimeFormat(LOCALE[language] || LOCALE.en, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(parsed.date);

  const value_of = (type) => normalizeSpaces(parts.find((p) => p.type === type)?.value || "").trim();
  const clock = `${value_of("hour")}:${value_of("minute")}`;
  const dayPeriod = value_of("dayPeriod");
  return dayPeriod ? `${clock} ${dayPeriod}` : clock;
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
  const date = normalizeSpaces(
    parsed.date.toLocaleDateString(LOCALE[language] || LOCALE.en, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })
  );
  const time = formatEventTime(startsAt, language);
  return time ? `${date}, ${time}` : date;
}

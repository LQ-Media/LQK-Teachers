// Pay configuration + time/money helpers for the Work Hours feature.
//
// Two pay systems (per LQK payroll):
//   • Class teaching  → the teacher's role rate (their pay tier, below).
//   • Ad-hoc / OT     → a flat OT_RATE for everyone, regardless of tier
//                       (centre cleaning, event planning, attending events…).
//
// To change a rate, edit the numbers here. Approved sessions snapshot the rate
// that applied at approval time, so past payroll is never rewritten by a change.
//
// No DB or server-only imports here — this module is shared by server actions
// and client components alike.

export const PAY_TIERS = [
  { key: "asst_probation", label: "Assistant (Probation)", short: "Asst · Probation", rate: 10 },
  { key: "asst", label: "Assistant Teacher", short: "Asst Teacher", rate: 15 },
  { key: "lead", label: "Lead Teacher", short: "Lead Teacher", rate: 20 },
  { key: "lead_ars", label: "Lead Teacher (ARS Cert)", short: "Lead · ARS", rate: 25 },
];

export const TIER_BY_KEY = Object.fromEntries(PAY_TIERS.map((t) => [t.key, t]));

// Flat overtime / ad-hoc rate, applied across every role.
export const OT_RATE = 10;

/**
 * Multiplier applied to the hourly rate for work on a Singapore public holiday.
 *
 * MOM does not publish a "public holiday multiplier". The Employment Act
 * entitles someone who works on a public holiday to an extra day's salary at
 * the basic rate of pay, on top of the gross rate for that day — which,
 * expressed as an hourly figure for hourly-paid staff, is 2x.
 *
 * Two things to be honest about before changing this:
 *  - The statutory rule is ADDITIVE, not multiplicative. For a part-timer it is
 *    "a day's pay + the pro-rated public-holiday entitlement", and that second
 *    part is derived from contracted annual hours against a comparable
 *    full-timer's — figures this portal does not hold. 2x is a deliberate
 *    approximation agreed with Karim, not the statute itself.
 *  - It only binds for staff covered by the Employment Act. Anyone engaged as a
 *    freelancer is outside it entirely.
 *
 * Changing this number only affects shifts approved from that point on: the
 * multiplier actually used is snapshotted onto the session at approval, exactly
 * like rate_cents. See lib/actions/hours.js#approveSession.
 *
 * Reference: https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay
 */
export const PH_MULTIPLIER = 2;

export const OT_REASONS = ["Centre cleaning", "Event planning", "Attending event", "Other"];

export const CATEGORIES = {
  teaching: { key: "teaching", label: "Class teaching" },
  ot: { key: "ot", label: "Ad-hoc / OT" },
};

/** Dollar/hour rate for a teaching pay tier, or null if the tier is unset/unknown. */
export function teachingRate(payTier) {
  return TIER_BY_KEY[payTier]?.rate ?? null;
}

/**
 * Best-guess pay tier from a free-text position (the imported Sheet wrote
 * things like "LEAD TEACHER, EVENTS TEAM" or "INTERN - ASSISTANT TEACHER").
 * Returns null for non-teaching roles (Founder, Finance Head, mentoring-only…)
 * so they're left unset rather than silently given a teaching rate.
 *
 * Order matters:
 *  - INTERN first: "INTERN - ASSISTANT TEACHER" is probation, not Assistant.
 *  - ARS before plain Lead: "ARS LEAD TEACHER" is the certified tier.
 *  - Lead before Assistant: "LEAD TEACHER, ASSISTANT TEACHER" takes the higher.
 * Note "ADMIN ASSISTANT" is not "ASSISTANT TEACHER", so it correctly returns null.
 */
export function tierForPosition(position) {
  const p = String(position || "").toUpperCase();
  if (!p) return null;
  if (p.includes("INTERN")) return "asst_probation";
  if (p.includes("ARS") && p.includes("LEAD TEACHER")) return "lead_ars";
  if (p.includes("LEAD TEACHER")) return "lead";
  if (p.includes("ASSISTANT TEACHER")) return "asst";
  return null;
}

/** The rate that applies to a session, or null if a teaching tier is missing. */
export function rateFor(category, payTier) {
  return category === "ot" ? OT_RATE : teachingRate(payTier);
}

// ---- Singapore time (UTC+8, no DST) -----------------------------------

/** SG calendar date (YYYY-MM-DD) for an ISO instant. */
export function sgDate(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

/** SG month (YYYY-MM) for an ISO instant. */
export function sgMonth(iso) {
  return sgDate(iso).slice(0, 7);
}

/** SG 24h clock (HH:MM) for an ISO instant — handy for <input type="time">. */
export function sgTime24(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Friendly SG clock, e.g. "2:05 PM". */
export function sgClock(iso) {
  return new Date(iso).toLocaleTimeString("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Today's SG date (YYYY-MM-DD). */
export function sgToday() {
  return sgDate(new Date().toISOString());
}

/** This SG month (YYYY-MM). */
export function sgMonthNow() {
  return sgMonth(new Date().toISOString());
}

/** ISO UTC instant for an SG local date + time ("2026-07-31", "14:05"). */
export function isoFromSg(dateStr, timeStr) {
  const t = /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : `${timeStr}:00`.slice(0, 5);
  const d = new Date(`${dateStr}T${t}:00+08:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Start/end instants for an SG shift, rolling the end to the next day when it
 * is not after the start. A 22:00–01:00 shift is a real thing a roster can
 * contain, and isoFromSg alone can't express one — it applies the same date to
 * both ends. Returns null if either time is unparseable.
 */
export function isoFromSgSpanning(dateStr, startStr, endStr) {
  const startsAt = isoFromSg(dateStr, startStr);
  let endsAt = isoFromSg(dateStr, endStr);
  if (!startsAt || !endsAt) return null;
  if (new Date(endsAt) <= new Date(startsAt)) {
    endsAt = isoFromSg(addSgDays(dateStr, 1), endStr);
    if (!endsAt) return null;
  }
  return { startsAt, endsAt };
}

/**
 * Shift an SG calendar date by n days. Anchored at noon SG so the arithmetic
 * can't be dragged over a boundary by the host's timezone — the container runs
 * UTC while a dev laptop runs UTC+8.
 */
export function addSgDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return sgDate(d.toISOString());
}

/**
 * SG weekday as 0=Sunday…6=Saturday, for a YYYY-MM-DD date. Same noon anchor,
 * for the same reason — do not reach for lib/date.js here, it reads the host's
 * local weekday and is wrong in production.
 */
export function sgWeekday(dateStr) {
  const short = new Date(`${dateStr}T12:00:00+08:00`).toLocaleDateString("en-US", {
    timeZone: "Asia/Singapore",
    weekday: "short",
  });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

/** Human month label, e.g. "July 2026", from "YYYY-MM". */
export function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Shift a "YYYY-MM" by n months. */
export function shiftMonth(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---- Duration + money -------------------------------------------------

/** Whole minutes between two ISO instants (>= 0). */
export function minutesBetween(startIso, endIso) {
  return Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 60000));
}

/** True if the session spans an SG midnight (start and end on different days). */
export function crossesSgMidnight(startIso, endIso) {
  return sgDate(startIso) !== sgDate(endIso);
}

/** A session's minutes look off (missing end, > 12h, or crosses midnight). */
export function isLongSession(startIso, endIso) {
  if (!endIso) return false;
  return minutesBetween(startIso, endIso) > 12 * 60 || crossesSgMidnight(startIso, endIso);
}

/** Pay in whole cents for `minutes` at `rateDollars`/hour. */
export function payCents(minutes, rateDollars) {
  if (rateDollars == null) return 0;
  return Math.round((minutes / 60) * rateDollars * 100);
}

/**
 * Pay for a session, applying the public-holiday multiplier when one was in
 * force. The multiplier scales the hourly rate and the result is rounded once,
 * so the cent is computed from the real figure rather than from a rounded one.
 * Pass the multiplier SNAPSHOTTED on the session, never PH_MULTIPLIER directly,
 * or changing the constant would silently rewrite past payroll.
 */
export function sessionPayCents(minutes, rateDollars, phMultiplier) {
  if (rateDollars == null) return 0;
  const m = Number(phMultiplier);
  return payCents(minutes, rateDollars * (Number.isFinite(m) && m > 0 ? m : 1));
}

/** "2h 05m" (or "0m"). */
export function formatHM(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (!h) return `${mm}m`;
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}

/** Decimal hours, 2 dp, e.g. 2.08. */
export function decimalHours(minutes) {
  return Math.round((minutes / 60) * 100) / 100;
}

/** "$123.50" from cents. */
export function formatMoney(cents) {
  return `$${(Math.round(cents) / 100).toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

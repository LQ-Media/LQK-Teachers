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
 * The management/team hats a non-teaching shift can be worn under.
 *
 * These mirror the Sling "positions" that are not teaching tiers, and they
 * exist for two reasons: the monthly report has to say WHICH team the hours
 * were for, and two of them are not paid at all.
 *
 * `rate: null` means TRACKED BUT NOT PAYABLE — Karim's decision of 16 Sep 2026
 * for the mentoring and IT teams, who are salaried and log hours only so the
 * month can be accounted for. Do not confuse it with a teaching tier of null,
 * which means "this teacher's tier has not been set yet" and BLOCKS approval.
 * The two nulls mean opposite things, so ask `isTrackedOnly()` rather than
 * testing the rate for nullness. `unpaidRole` on a session is what carries the
 * decision forward; like rate_cents it is snapshotted at approval.
 *
 * A null/unknown role is plain OT at OT_RATE, which is what an ordinary
 * non-teaching hour has always been.
 */
export const OT_ROLES = [
  { key: "curriculum", label: "Curriculum Team", short: "Curriculum", rate: OT_RATE },
  { key: "events", label: "Events Team", short: "Events", rate: OT_RATE },
  { key: "logistics", label: "Logistics Team", short: "Logistics", rate: OT_RATE },
  { key: "mentoring", label: "Mentoring Team", short: "Mentoring", rate: null },
  { key: "it", label: "IT Team", short: "IT", rate: null },
];

export const OT_ROLE_BY_KEY = Object.fromEntries(OT_ROLES.map((r) => [r.key, r]));

/** True when a team's hours are logged for the record but never paid. */
export function isTrackedOnly(otRole) {
  const role = OT_ROLE_BY_KEY[otRole];
  return !!role && role.rate == null;
}

/**
 * Dollar/hour for a non-teaching shift. Plain OT and the three paid teams all
 * sit at OT_RATE; the tracked-only teams return 0 so they total to no pay
 * without ever looking like a missing rate.
 */
export function otRate(otRole) {
  if (!otRole) return OT_RATE;
  const role = OT_ROLE_BY_KEY[otRole];
  if (!role) return OT_RATE;
  return role.rate == null ? 0 : role.rate;
}

/**
 * Multiplier applied to the hourly rate for work on a Singapore public holiday.
 *
 * 1.5x, set by Karim on 16 Sep 2026. It applies to the PUBLIC HOLIDAY ITSELF
 * and to nothing else — there is no eve-of-holiday rate here. That falls out of
 * the data for free: lib/hours/holidays.js loads MOM's published holiday list,
 * which contains the holidays and not their eves, so `ph_name` is only ever set
 * on the day itself.
 *
 * This replaced 2x, which was an earlier approximation of the Employment Act's
 * additive entitlement. Two things to be honest about:
 *  - MOM does not publish a "public holiday multiplier" at all. The statutory
 *    rule is ADDITIVE: an extra day's salary at the basic rate on top of the
 *    gross rate for that day. For a part-timer the second part is pro-rated
 *    from contracted annual hours against a comparable full-timer's — figures
 *    this portal does not hold. 1.5x is LQK's own rate, not the statute.
 *  - It only binds for staff covered by the Employment Act. Anyone engaged as a
 *    freelancer is outside it entirely.
 *
 * Changing this number only affects shifts approved from that point on: the
 * multiplier actually used is snapshotted onto the session at approval, exactly
 * like rate_cents. See lib/actions/hours.js#approveSession. So sessions already
 * approved at 2x keep paying 2x, by design — if any exist they need reviewing
 * by hand, not by editing this constant.
 *
 * Reference: https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay
 */
export const PH_MULTIPLIER = 1.5;

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

/**
 * The rate that applies to a session, or null if a teaching tier is missing.
 *
 * `otRole` is optional and only read for non-teaching sessions. Omitting it
 * keeps the old behaviour — plain OT at OT_RATE.
 */
export function rateFor(category, payTier, otRole) {
  return category === "ot" ? otRate(otRole) : teachingRate(payTier);
}

/**
 * Hours as LQK rounds them for payroll: to the NEAREST HALF HOUR, with a tie
 * rounding up. Karim's rule of 16 Sep 2026, and it reproduces all five of his
 * worked examples:
 *
 *   5h10m -> 5     (10 past the half-hour mark, so down)
 *   5h15m -> 5.5   (a tie at 15, so up)
 *   5h30m -> 5.5   (already on a mark)
 *   5h45m -> 6     (a tie at 45, so up)
 *     15m -> 0.5   (a tie at 15, so up)
 *
 * Put another way: inside each half-hour block, under 15 minutes rounds down
 * and 15 or more rounds up.
 *
 * This supersedes his first description of the rule, which rounded to whole
 * hours and gave 5h20m -> 5. Under the half-hour rule 5h20m is 5.5, because 20
 * is past the 15-minute tipping point. Returns a multiple of 0.5.
 *
 * Applied ONCE, to a period total, never per shift — rounding each shift and
 * then adding them would compound the error across ~20 shifts into something
 * nobody could reconcile against the roster.
 */
export function payrollHours(minutes) {
  return Math.round(Math.max(0, minutes) / 30) / 2;
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

/**
 * The assessment calendar. Pure, no database, tested under UTC and SGT.
 *
 * Semesters are the two halves of the year (Karim's decision, not MOE terms):
 * Semester 1 is January to June, Semester 2 is July to December. Every date
 * here is a Singapore calendar date in YYYY-MM-DD form — the same convention
 * as the payroll helpers in lib/hours/rates.js, and for the same reason: the
 * production container runs UTC, so `new Date().getMonth()` is wrong for
 * nine hours of every day.
 */

import { sgToday } from "../hours/rates.js";

export const SEMESTERS = [1, 2];

/** From the 1st of October every teacher without an assessment is chased. */
export const CHASE_FROM_MONTH = 10;
/** Every teacher must have at least one assessment on file by this date. */
export const DEADLINE_MONTH = 11;
export const DEADLINE_DAY = 30;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateString(s) {
  const m = DATE_RE.exec(String(s || ""));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  // Reject 31 February and friends: Date.UTC rolls them over, so compare.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** { year, semester } for a Singapore date string. Throws on garbage. */
export function periodFor(dateStr) {
  if (!isDateString(dateStr)) throw new Error(`Not a date: ${dateStr}`);
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  return { year, semester: month <= 6 ? 1 : 2 };
}

export function currentPeriod() {
  return periodFor(sgToday());
}

/** Inclusive date bounds of a semester, as YYYY-MM-DD strings. */
export function periodBounds(year, semester) {
  if (!SEMESTERS.includes(semester)) throw new Error(`Not a semester: ${semester}`);
  return semester === 1
    ? { from: `${year}-01-01`, to: `${year}-06-30` }
    : { from: `${year}-07-01`, to: `${year}-12-31` };
}

export function periodLabel(year, semester) {
  return `Semester ${semester} ${year}`;
}

export function periodShort(year, semester) {
  return `S${semester} ${year}`;
}

/** The November deadline for a given year, as a date string. */
export function deadlineFor(year) {
  return `${year}-${String(DEADLINE_MONTH).padStart(2, "0")}-${DEADLINE_DAY}`;
}

/**
 * Where a teacher stands against the November rule on a given day.
 *
 *   "done"    — at least one submitted assessment this year
 *   "open"    — none yet, but it is not October, so nobody is chased
 *   "chase"   — none yet and it is October or November: on the tracker in red
 *   "missed"  — none yet and the deadline has passed
 *
 * `today` and `year` are separate so the admin page can look at a past year
 * ("who did we miss in 2026") without pretending it is still that year.
 */
export function deadlineStatus({ today, year, hasAssessment }) {
  if (hasAssessment) return "done";
  if (!isDateString(today)) throw new Error(`Not a date: ${today}`);
  const todayYear = Number(today.slice(0, 4));
  if (todayYear > year) return "missed";
  if (todayYear < year) return "open";
  if (today > deadlineFor(year)) return "missed";
  const month = Number(today.slice(5, 7));
  return month >= CHASE_FROM_MONTH ? "chase" : "open";
}

/** The years an admin can pick from: this one, and every year with data. */
export function yearOptions(currentYear, yearsWithData = []) {
  const set = new Set([currentYear, ...yearsWithData.map(Number).filter(Number.isInteger)]);
  return [...set].sort((a, b) => b - a);
}

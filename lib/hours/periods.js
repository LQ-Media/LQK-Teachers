// Payroll periods — the calendar payroll actually runs on.
//
// It is NOT the calendar month. LQK publishes a table of cut-off dates each
// year and the salary periods they close, and the periods are irregular: some
// are a calendar month, most run from just after one cut-off to a few days
// before the next. August 2026 pay, for instance, covers 27 July to 23 August.
//
// This matters more than it looks. Every total, every export and every "have
// we been paid for this yet" answer has to agree with the table the Mentor and
// IT Heads are working from, or the portal and the payslip will disagree by a
// few days' shifts every single month.
//
// TWO ROLES, easily confused:
//
//   from/to  — the SALARY PERIOD. Which shifts are paid in this run.
//   cutOff   — the DEADLINE for MH/IT Heads to have entered them. Per the
//              Mentor & IT Heads guide: "Any shifts added after the dateline
//              will be brought forward to the next payroll." So the cut-off
//              decides WHEN a shift must be in by, never WHICH period it
//              belongs to — that is always its own date.
//
// The cut-off usually falls a day or two AFTER the period it closes, which is
// what leaves Kak Siti the two days the guide describes for running payroll.
//
// Pure — no DB, no server imports.

import { sgDate } from "./rates.js";

/**
 * 2026, transcribed from "SLING CUT-OFF DATES 2026 FOR MH/IT HEADS".
 *
 * `cutOff` is Singapore local time; 12:00 PM in the table is noon, and two
 * rows are 11:00 PM instead. The weekday each row claims is asserted in
 * test/periods.test.mjs, which is the cheapest guard there is against a
 * transcription slip in a table that decides when people get paid.
 *
 * THE FIRST TWO ROWS name a month rather than dates ("MARCH", "APRIL"). They
 * are taken here as the whole calendar month, which is the only reading that
 * leaves the year contiguous — April has to end on the 30th for the next
 * period to start on 1 May. Confirm before the 2027 table is entered.
 *
 * JANUARY AND FEBRUARY are absent from the published table and so absent here.
 * periodFor() returns null for those dates rather than guessing a period.
 *
 * ONE ROW IN THE PUBLISHED TABLE DISAGREES WITH THE CALENDAR. It reads
 * "27 July (Tuesday), 11:00 PM", but 27 July 2026 is a MONDAY; 28 July is the
 * Tuesday. The other nine rows check out. The DATE is taken as authoritative
 * here, because the date is the operative field and the weekday is a label on
 * it — but this is unresolved, and if 28 July was meant then the deadline MH
 * and IT Heads are working to is a day later than this file says. Raised with
 * Karim 16 Sep 2026. test/periods.test.mjs pins the discrepancy so that fixing
 * one without the other fails loudly.
 */
export const PAYROLL_PERIODS_2026 = [
  { key: "2026-03", label: "March", from: "2026-03-01", to: "2026-03-31", cutOff: "2026-03-29T23:00" },
  { key: "2026-04", label: "April", from: "2026-04-01", to: "2026-04-30", cutOff: "2026-04-28T12:00" },
  { key: "2026-05", label: "May", from: "2026-05-01", to: "2026-05-24", cutOff: "2026-05-26T12:00" },
  { key: "2026-06", label: "June", from: "2026-05-25", to: "2026-06-30", cutOff: "2026-06-28T12:00" },
  { key: "2026-07", label: "July", from: "2026-07-01", to: "2026-07-26", cutOff: "2026-07-27T23:00" },
  { key: "2026-08", label: "August", from: "2026-07-27", to: "2026-08-23", cutOff: "2026-08-25T12:00" },
  { key: "2026-09", label: "September", from: "2026-08-24", to: "2026-09-30", cutOff: "2026-09-28T12:00" },
  { key: "2026-10", label: "October", from: "2026-10-01", to: "2026-10-25", cutOff: "2026-10-27T12:00" },
  { key: "2026-11", label: "November", from: "2026-10-26", to: "2026-11-22", cutOff: "2026-11-24T12:00" },
  { key: "2026-12", label: "December", from: "2026-11-23", to: "2026-12-31", cutOff: "2026-12-29T12:00" },
];

/** Every period LQK has published, newest year last. */
export const PAYROLL_PERIODS = [...PAYROLL_PERIODS_2026];

/** The periods of one calendar year, in order. */
export function periodsForYear(year) {
  const prefix = `${year}-`;
  return PAYROLL_PERIODS.filter((p) => p.key.startsWith(prefix));
}

/** A period by its key, or null. */
export function periodByKey(key) {
  return PAYROLL_PERIODS.find((p) => p.key === key) || null;
}

/**
 * The period an SG date falls in, or null when the published table does not
 * cover it — January and February 2026, or any year not yet entered.
 *
 * Null is deliberate. Inventing a period for an uncovered date would put real
 * shifts into a payroll run that nobody has agreed exists.
 */
export function periodFor(dateStr) {
  if (!dateStr) return null;
  return PAYROLL_PERIODS.find((p) => dateStr >= p.from && dateStr <= p.to) || null;
}

/** The period an ISO instant falls in, read in Singapore time. */
export function periodForInstant(iso) {
  return iso ? periodFor(sgDate(iso)) : null;
}

/** The period after this one, or null at the end of the published table. */
export function nextPeriod(period) {
  if (!period) return null;
  const i = PAYROLL_PERIODS.findIndex((p) => p.key === period.key);
  return i >= 0 ? PAYROLL_PERIODS[i + 1] || null : null;
}

/** The cut-off as an ISO instant (the table's times are SG local). */
export function cutOffInstant(period) {
  return period ? new Date(`${period.cutOff}:00+08:00`).toISOString() : null;
}

/**
 * Has this period's cut-off passed?
 *
 * Past the cut-off, a newly entered shift still BELONGS to the period its date
 * falls in — it just misses this payroll run and is carried to the next, as
 * the guide says. Callers use this to warn, never to re-date a shift.
 */
export function isPastCutOff(period, nowIso = new Date().toISOString()) {
  const cut = cutOffInstant(period);
  return !!cut && new Date(nowIso) > new Date(cut);
}

/**
 * Which payroll run a shift will actually be PAID in: its own period, or the
 * next one if it was entered after that period's cut-off had passed.
 *
 * Returns null when the date is outside the published table, and falls back to
 * the shift's own period at the end of the table rather than dropping it.
 */
export function payRunFor(shiftDate, enteredAtIso) {
  const period = periodFor(shiftDate);
  if (!period) return null;
  if (!enteredAtIso || !isPastCutOff(period, enteredAtIso)) return period;
  return nextPeriod(period) || period;
}

/** "27 Jul – 23 Aug 2026", for a heading. */
export function periodRangeLabel(period) {
  if (!period) return "";
  const fmt = (d, withYear) =>
    new Date(`${d}T12:00:00+08:00`).toLocaleDateString("en-SG", {
      timeZone: "Asia/Singapore",
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  return `${fmt(period.from, false)} – ${fmt(period.to, true)}`;
}

// Rostered shifts: matching a clock-in to what the teacher was scheduled to do.
//
// The model in one line: `shifts` is the plan, `work_sessions` is what gets
// paid, and a session copies the shift's window when it is created — so pay is
// the ROSTERED shift and editing a shift afterwards can never rewrite somebody's
// pay. Clock-in is attendance evidence only; by Karim's decision lateness is
// recorded but never flagged.
//
// Pure functions only — no DB, no server imports — so this module is shared by
// server actions and client components, and so the rules below can be tested
// directly. Everything date-shaped goes through the SG helpers in rates.js;
// lib/date.js reads the HOST's local weekday and is wrong in production, where
// the container runs UTC.

import { sgDate, sgWeekday, addSgDays, isoFromSgSpanning } from "./rates.js";

/**
 * How early a teacher may clock in for a shift, and how long a gap two shifts
 * may have while still counting as one continuous block.
 *
 * BLOCK_GAP_MIN is the one that matters most. Back-to-back shifts (09:00–11:00
 * then 11:00–13:00) are normal here, and a teacher taps once, at the start. If
 * the second shift didn't resolve from that same tap it would read as missed,
 * and an IT Head would chase a teacher for a class they actually taught. Do
 * that weekly across ~77 staff and the exception report stops being believed.
 */
export const EARLY_GRACE_MIN = 30;
export const BLOCK_GAP_MIN = 30;

export const MISSED_REASONS = [
  "Forgot to clock in",
  "Phone or app problem",
  "Was not working this shift",
  "Other",
];

const MIN = 60 * 1000;

/** Shifts a teacher could still act on: planned, not already cancelled. */
export function isLive(shift) {
  return !!shift && shift.status !== "cancelled";
}

/**
 * Group a day's shifts into continuous blocks. Input should be one teacher's
 * shifts; order doesn't matter. A block is a maximal chain where each shift
 * starts no more than BLOCK_GAP_MIN after the previous one ends.
 */
export function blocksOf(shifts) {
  const live = (shifts || []).filter(isLive).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const blocks = [];
  for (const s of live) {
    const block = blocks[blocks.length - 1];
    const prev = block && block[block.length - 1];
    if (prev && new Date(s.startsAt) - new Date(prev.endsAt) <= BLOCK_GAP_MIN * MIN) {
      block.push(s);
    } else {
      blocks.push([s]);
    }
  }
  return blocks;
}

/**
 * Which shift is a clock-in at `nowIso` for?
 *
 * Candidates are that teacher's live shifts on the SG date of the tap, earliest
 * first. A tap lands on the first shift whose window it falls inside (allowing
 * EARLY_GRACE_MIN before the start); failing that, on the nearest shift starting
 * within the grace window. No candidate means unscheduled, which is allowed —
 * a gap in the roster must never stop someone recording that they worked.
 *
 * Returns null when nothing matches.
 */
export function matchShift(shifts, nowIso) {
  const now = new Date(nowIso).getTime();
  const today = sgDate(nowIso);
  const live = (shifts || [])
    .filter((s) => isLive(s) && s.date === today)
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  for (const s of live) {
    const start = new Date(s.startsAt).getTime();
    const end = new Date(s.endsAt).getTime();
    if (now >= start - EARLY_GRACE_MIN * MIN && now <= end) return s;
  }
  return null;
}

/**
 * Every shift a single clock-in should realise: the matched shift plus the rest
 * of its continuous block. One tap covers a whole afternoon of back-to-back
 * classes, but each shift still becomes its own work_sessions row so per-shift
 * edits and the unique-on-shift_id guard both keep working.
 */
export function shiftsRealisedBy(shifts, nowIso) {
  const matched = matchShift(shifts, nowIso);
  if (!matched) return [];
  const block = blocksOf(shifts.filter((s) => s.date === matched.date)).find((b) =>
    b.some((s) => s.id === matched.id)
  );
  return block || [matched];
}

/**
 * Is this teacher on shift right now?
 *
 * Replaces the old "a row with ended_at IS NULL means clocked in" test, which a
 * rostered session breaks: its ended_at is set from the schedule at clock-in, so
 * nothing is ever left running and that check would read false forever — leaving
 * the clock-in button live and inviting a second tap.
 */
export function isOnShift(session, nowIso) {
  if (!session?.clockInAt || session.clockOutAt) return false;
  const now = new Date(nowIso).getTime();
  return now >= new Date(session.startedAt).getTime() && now < new Date(session.endedAt).getTime();
}

/**
 * Has this shift finished? Pay is only ever payable once the work has actually
 * happened — a rostered session carries a FUTURE ended_at from the moment it is
 * created, and treating that as "done" would let tomorrow's class be approved
 * and paid today.
 */
export function hasFinished(shiftOrSession, nowIso) {
  const end = shiftOrSession?.endsAt || shiftOrSession?.endedAt;
  return !!end && new Date(end) <= new Date(nowIso);
}

/**
 * A past shift that nobody clocked in for and nobody has resolved — the list
 * the teacher gets asked about and the IT Head follows up. Cancelled shifts and
 * already-resolved ones are excluded, so a rejected explanation is never asked
 * for twice.
 */
export function isMissed(shift, nowIso, hasSession) {
  return isLive(shift) && !hasSession && !shift.resolution && hasFinished(shift, nowIso);
}

/** Minutes a shift is rostered for. */
export function shiftMinutes(shift) {
  return Math.max(0, Math.round((new Date(shift.endsAt) - new Date(shift.startsAt)) / MIN));
}

/**
 * Expand a recurring pattern into concrete dates.
 *
 * Materialised deliberately, rather than stored as a rule: the weekly
 * missed-clock-in report is "shifts with no session", which is one join over
 * real rows, and every occurrence needs somewhere to hold its own state anyway
 * (cancelled, reason given, resolved). A rule plus an exceptions table is the
 * same thing with more moving parts.
 *
 * `weekdays` is 0=Sunday…6=Saturday. `skipDates` is a Set of YYYY-MM-DD to leave
 * out — public holidays, typically.
 */
export function expandDates(fromDate, toDate, weekdays, skipDates) {
  const want = new Set(weekdays || []);
  const skip = skipDates || new Set();
  const out = [];
  if (!want.size || !fromDate || !toDate || fromDate > toDate) return out;
  // Guard against a typo'd end date generating years of rows.
  for (let d = fromDate, i = 0; d <= toDate && i < 800; d = addSgDays(d, 1), i++) {
    if (want.has(sgWeekday(d)) && !skip.has(d)) out.push(d);
  }
  return out;
}

/**
 * Build the rows for a bulk generation. Returns {rows, skipped} — skipped
 * carries the dates left out and why, so the admin sees "23 skipped (public
 * holiday)" rather than silently getting fewer shifts than they asked for.
 */
export function buildShiftRows({ fromDate, toDate, weekdays, startTime, endTime, holidays, skipHolidays }) {
  const holidayMap = holidays || new Map();
  const skipSet = skipHolidays ? new Set(holidayMap.keys()) : new Set();
  const dates = expandDates(fromDate, toDate, weekdays, skipSet);
  const rows = [];
  for (const date of dates) {
    const span = isoFromSgSpanning(date, startTime, endTime);
    if (!span) continue;
    rows.push({ date, ...span, phName: holidayMap.get(date) || null });
  }
  const skipped = skipHolidays
    ? expandDates(fromDate, toDate, weekdays, new Set())
        .filter((d) => holidayMap.has(d))
        .map((d) => ({ date: d, reason: holidayMap.get(d) }))
    : [];
  return { rows, skipped };
}

/** Do two shifts for the same teacher overlap in time? */
export function overlaps(a, b) {
  return new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt);
}

/**
 * Overlapping pairs within a set of shifts. Checked when an admin rosters, not
 * when a teacher clocks in — at clock-in it is far too late, and the teacher is
 * the wrong person to tell about a rostering mistake.
 */
export function findOverlaps(shifts) {
  const live = (shifts || []).filter(isLive).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const clashes = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (new Date(live[j].startsAt) >= new Date(live[i].endsAt)) break;
      if (overlaps(live[i], live[j])) clashes.push([live[i], live[j]]);
    }
  }
  return clashes;
}

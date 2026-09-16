// Attendance: what the clock-in tap means for pay, and for the exception list.
//
// THE PAY WINDOW, in one line: pay runs from the SCHEDULED START (or the
// clock-in, if that is later) to the SCHEDULED END.
//
// Both halves of that are deliberate, and both were settled by Karim on
// 16 Sep 2026:
//
//   • Clocking in EARLY earns nothing. The roster already builds in 30 minutes
//     before the class and an hour after, and the app lets a teacher tap up to
//     30 minutes before that. Paying from the tap would pay for arriving early
//     — 80 shifts in Aug 2026 clocked in early, worth ~15 extra hours. Early
//     taps are attendance evidence, nothing more.
//   • Clocking in LATE costs the teacher the time they missed. This is the
//     change from the old "pay is the rostered shift" rule, which this module
//     replaces.
//   • There is NO clock-out. Teachers cannot end a shift early, because ending
//     it early would be editing their own pay. Pay always runs to the
//     scheduled end, and only an IT Head or Mentor Head can move either edge.
//
// A missing clock-in pays NOTHING until somebody adjusts it. That is not a
// punishment, it is the honest reading: nothing evidences that the shift was
// worked. The weekly loop closes it — the IT Head collects the reason, writes
// it into the shift's note where the export will show it, and sets a clock-in
// time if the reason warrants one.
//
// Pure functions only — no DB, no server imports — so this is shared by server
// actions and client components, and so the rules above can be tested directly.

import { minutesBetween } from "./rates.js";

/**
 * When a clock-in counts as LATE. Karim's line of 16 Sep 2026: "15 min and
 * after is considered late."
 *
 * Not a grace period for pay — a late tap always costs the teacher those
 * minutes, whether it is 4 minutes or 40. This decides only what LQK calls
 * late: what shows as late on the report and what reaches the IT Heads' weekly
 * chase, so that list is about shifts that actually went wrong rather than
 * about somebody three minutes behind a bus.
 *
 * Clock-ins are rounded to 5 minutes before they reach here (matching Sling),
 * so anything above zero is already at least a 5-minute block.
 */
export const LATE_FLAG_MIN = 15;

/** A clock-in is expected for teaching shifts only; OT is entered by an admin. */
export function expectsClockIn(shift) {
  return !!shift && shift.category !== "ot" && shift.status !== "cancelled";
}

/**
 * What the clock-in says about attendance.
 *
 *   missing  — expected a tap, never got one
 *   late     — tapped after the scheduled start
 *   early    — tapped before it (recorded, never paid)
 *   on_time  — tapped at it
 *   n/a      — no tap was expected (OT, cancelled)
 *
 * `lateMinutes` is what the teacher loses; `earlyMinutes` is what they are not
 * paid for. Exactly one of them is ever non-zero.
 */
export function attendanceOf(shift, clockInIso) {
  if (!expectsClockIn(shift)) {
    return { state: "n/a", lateMinutes: 0, earlyMinutes: 0, flagged: false };
  }
  if (!clockInIso) {
    return { state: "missing", lateMinutes: 0, earlyMinutes: 0, flagged: true };
  }

  const scheduled = new Date(shift.startsAt);
  const actual = new Date(clockInIso);
  if (Number.isNaN(actual.getTime()) || Number.isNaN(scheduled.getTime())) {
    return { state: "missing", lateMinutes: 0, earlyMinutes: 0, flagged: true };
  }

  if (actual > scheduled) {
    const lateMinutes = minutesBetween(shift.startsAt, clockInIso);
    return { state: "late", lateMinutes, earlyMinutes: 0, flagged: lateMinutes >= LATE_FLAG_MIN };
  }
  if (actual < scheduled) {
    return {
      state: "early",
      lateMinutes: 0,
      earlyMinutes: minutesBetween(clockInIso, shift.startsAt),
      flagged: false,
    };
  }
  return { state: "on_time", lateMinutes: 0, earlyMinutes: 0, flagged: false };
}

/**
 * The window a shift actually pays for, or null when nothing is payable.
 *
 * Returns null for a missing clock-in on a teaching shift, and for a tap that
 * landed after the shift had already ended — there is no negative window, and
 * a zero-length one would read as "worked, earned nothing" rather than
 * "unresolved".
 *
 * OT needs no tap: it pays its whole rostered window, because an admin only
 * enters it after the work has happened.
 */
export function payableWindow(shift, clockInIso) {
  if (!shift || shift.status === "cancelled") return null;

  if (!expectsClockIn(shift)) {
    return {
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      minutes: minutesBetween(shift.startsAt, shift.endsAt),
    };
  }

  if (!clockInIso) return null;

  const startsAt = new Date(clockInIso) > new Date(shift.startsAt) ? clockInIso : shift.startsAt;
  if (new Date(startsAt) >= new Date(shift.endsAt)) return null;

  return { startsAt, endsAt: shift.endsAt, minutes: minutesBetween(startsAt, shift.endsAt) };
}

/**
 * Round a clock-in to the nearest 5 minutes, as Sling does, so the roster and
 * the timesheet agree on what "7:33" was. Rounding to NEAREST rather than down
 * keeps it even-handed: it can cost a teacher up to 2 minutes or give them up
 * to 2, where rounding down would always favour them and rounding up never
 * would.
 */
export const CLOCK_ROUNDING_MIN = 5;

export function roundClockIn(iso) {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const ms = CLOCK_ROUNDING_MIN * 60 * 1000;
  return new Date(Math.round(t.getTime() / ms) * ms).toISOString();
}

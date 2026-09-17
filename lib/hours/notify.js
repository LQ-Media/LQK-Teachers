// Which shift notifications are due right now, and what they say.
//
// Karim asked for three, on 16 Sep 2026: "reminder on their shift, havent
// clock in, someone put their shift to be available to their phone". The IT
// Heads also "receive the late notification of their centre teachers".
//
// This module decides WHAT to send and WHEN. It does not know about the
// database, web-push, or who the IT Heads are — that is the scheduler's job.
// Keeping the decision pure is what lets the timing be tested directly,
// including the cases that only happen at 6am on a Saturday after a redeploy.
//
// The two rules that shape everything below:
//
//   • A notification is worth sending only while it can still change what
//     somebody does. "Your shift starts in 30 minutes" is useful; the same
//     message an hour after the shift ended is noise, and noise is how people
//     learn to swipe the portal's notifications away without reading them.
//   • A missed tick must not become a missed notification. The server restarts
//     on every deploy, and Railway can take a minute to come back. So these are
//     windows, not instants — and the text is computed from the ACTUAL time
//     remaining, so a reminder that goes out late still tells the truth.

import { sgClock } from "./rates.js";
import { expectsClockIn, LATE_FLAG_MIN } from "./attendance.js";

/**
 * How long before a shift the reminder goes out.
 *
 * 30 minutes because that is when leaving the house stops being optional. The
 * roster already opens 30 minutes before the class, so this lands at the
 * moment the teacher could first clock in.
 */
export const REMIND_BEFORE_MIN = 30;

/**
 * How late a teacher can be before the "you haven't clocked in" push goes out,
 * to them and to their centre's IT Heads.
 *
 * Deliberately the SAME threshold as the report's late flag — if a shift is
 * late enough to appear on the IT Head's weekly exception list, it is late
 * enough to be worth a message while the class is still happening. Two
 * different numbers for "late" would be two different definitions of late.
 */
export const NO_CLOCK_IN_AFTER_MIN = LATE_FLAG_MIN;

export const KINDS = ["reminder", "no_clock_in", "offered"];

function minutesFrom(fromIso, toIso) {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
}

/**
 * Is a reminder due for this shift at `nowIso`?
 *
 * The window is [start - 30min, start). It opens 30 minutes before and closes
 * at the start — not at some fixed instant — so a server that was down at the
 * 30-minute mark still sends the reminder when it comes back, as long as the
 * shift has not already begun. Once it has, the reminder has nothing left to
 * remind anybody of and the no-clock-in push takes over.
 */
export function reminderDue(shift, nowIso) {
  if (!expectsClockIn(shift)) return false;
  const remaining = minutesFrom(nowIso, shift.startsAt);
  return remaining > 0 && remaining <= REMIND_BEFORE_MIN;
}

/**
 * Is the "you haven't clocked in" push due?
 *
 * Opens 15 minutes after the scheduled start and closes at the scheduled end.
 * The closing edge matters: after the shift is over, nothing the teacher does
 * on their phone fixes it, and the shift belongs to the IT Head's exception
 * list instead. Sending then would be telling somebody about a problem at the
 * exact moment it stopped being solvable.
 */
export function noClockInDue(shift, clockInIso, nowIso) {
  if (!expectsClockIn(shift)) return false;
  if (clockInIso) return false;
  const sinceStart = minutesFrom(shift.startsAt, nowIso);
  if (sinceStart < NO_CLOCK_IN_AFTER_MIN) return false;
  return new Date(nowIso) < new Date(shift.endsAt);
}

/**
 * Everything due for one shift at `nowIso`, as {kind, minutes} entries.
 * `minutes` is the real figure the message should quote, not the threshold.
 */
export function dueFor(shift, clockInIso, nowIso) {
  const out = [];
  if (reminderDue(shift, nowIso)) {
    out.push({ kind: "reminder", minutes: minutesFrom(nowIso, shift.startsAt) });
  }
  if (noClockInDue(shift, clockInIso, nowIso)) {
    out.push({ kind: "no_clock_in", minutes: minutesFrom(shift.startsAt, nowIso) });
  }
  return out;
}

function placeSuffix(shift) {
  return shift?.branch ? ` at ${shift.branch}` : "";
}

/**
 * The message a TEACHER sees. `minutes` comes from dueFor, so the wording
 * matches reality even when the push went out later than intended.
 */
export function teacherMessage(kind, shift, minutes) {
  const at = sgClock(shift.startsAt);
  if (kind === "reminder") {
    const when = minutes <= 1 ? "in a minute" : `in ${minutes} minutes`;
    return {
      title: `Shift ${when} — ${at}`,
      body: `Your shift${placeSuffix(shift)} starts at ${at}. Clock in when you arrive.`,
      url: "/hours",
      tag: `shift-reminder-${shift.id}`,
    };
  }
  if (kind === "no_clock_in") {
    return {
      title: "You haven't clocked in",
      body:
        `Your ${at} shift${placeSuffix(shift)} started ${minutes} minutes ago and there's no clock-in yet. ` +
        `Tap to clock in, or tell your IT Head what happened.`,
      url: "/hours",
      tag: `shift-noclockin-${shift.id}`,
    };
  }
  if (kind === "offered") {
    return {
      title: "A shift is available",
      body: `${sgClock(shift.startsAt)}${placeSuffix(shift)} needs cover. Tap to take it.`,
      url: "/hours",
      tag: `shift-offered-${shift.id}`,
    };
  }
  return null;
}

/**
 * The message an IT HEAD sees. Same event, different job: the teacher is being
 * asked to act, the IT Head is being told who to chase. So this one leads with
 * the NAME — an IT Head covering two centres reads this on a phone, and the
 * first word has to be the thing they need.
 */
export function managerMessage(kind, shift, minutes) {
  if (kind !== "no_clock_in") return null;
  const who = shift.teacherName || "A teacher";
  return {
    title: `${who} hasn't clocked in`,
    body:
      `${sgClock(shift.startsAt)} shift${placeSuffix(shift)}, ${minutes} minutes ago. ` +
      `No clock-in recorded.`,
    url: "/admin?tab=shifts",
    tag: `mgr-noclockin-${shift.id}`,
  };
}

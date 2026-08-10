import { requireSession } from "@/lib/dal";
import { getDb, LOCATIONS } from "@/lib/db";
import {
  sgMonthNow,
  sgMonth,
  sgToday,
  monthLabel,
  minutesBetween,
  isLongSession,
  sessionPayCents,
  rateFor,
  teachingRate,
  addSgDays,
  PH_MULTIPLIER,
} from "@/lib/hours/rates";
import { isOnShift, isMissed, shiftMinutes, matchShift } from "@/lib/hours/shifts";
import HoursApp from "@/components/hours/HoursApp";

export const metadata = { title: "Work hours · LQK Teachers Portal" };

// Shape a DB row into a plain object for the client (node:sqlite rows have a
// null prototype and can't cross the server→client boundary directly).
function shape(row, nowIso) {
  const s = {
    id: row.id,
    category: row.category,
    otReason: row.ot_reason || null,
    branch: row.branch || null,
    startedAt: row.started_at,
    endedAt: row.ended_at || null,
    note: row.note || null,
    status: row.status,
    rateCents: row.rate_cents ?? null,
    reviewerNote: row.reviewer_note || null,
    shiftId: row.shift_id || null,
    clockInAt: row.clock_in_at || null,
    clockOutAt: row.clock_out_at || null,
    source: row.source || "legacy",
    phName: row.ph_name || null,
    phMultiplier: row.ph_multiplier ?? null,
    geo:
      row.geo_lat == null || row.geo_lng == null
        ? null
        : {
            lat: row.geo_lat,
            lng: row.geo_lng,
            accuracy: row.geo_accuracy ?? null,
            label: row.geo_label || null,
            at: row.geo_at || null,
          },
    minutes: row.ended_at ? minutesBetween(row.started_at, row.ended_at) : null,
    // A rostered shift looks however the roster says it should, so the
    // "Check times" warning would fire on every legitimate late class.
    long: row.shift_id ? false : isLongSession(row.started_at, row.ended_at),
  };
  s.onShift = isOnShift(s, nowIso);
  return s;
}

function shapeShift(row) {
  return {
    id: row.id,
    category: row.category,
    otReason: row.ot_reason || null,
    branch: row.branch || null,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    cancelReason: row.cancel_reason || null,
    phName: row.ph_name || null,
    unpaid: !!row.unpaid,
    missedReason: row.missed_reason || null,
    resolution: row.resolution || null,
    note: row.note || null,
    sessionId: row.session_id ?? null,
    minutes: shiftMinutes({ startsAt: row.starts_at, endsAt: row.ends_at }),
  };
}

export default async function HoursPage() {
  const session = await requireSession();
  const db = getDb();
  const uid = session.userId;
  const month = sgMonthNow();
  const now = new Date().toISOString();
  const today = sgToday();

  const prof = db.prepare("SELECT pay_tier, primary_location FROM profiles WHERE id = ?").get(uid) || {};
  const tierRate = teachingRate(prof.pay_tier);

  // Branch options: the teacher's own branches (primary first), else all. Still
  // needed for an unscheduled clock-in — a rostered shift brings its own.
  const locRows = db.prepare("SELECT location, is_primary FROM teacher_locations WHERE teacher_id = ?").all(uid);
  const locs = [];
  const seen = new Set();
  const add = (l) => {
    if (l && !seen.has(l)) {
      seen.add(l);
      locs.push(l);
    }
  };
  add(prof.primary_location);
  for (const r of [...locRows].sort((a, b) => b.is_primary - a.is_primary)) add(r.location);
  const branchOptions = locs.length ? locs : LOCATIONS;

  // Only an UNSCHEDULED tap is ever left running — a rostered session knows
  // when it ends the moment it starts.
  const runningRow = db.prepare("SELECT * FROM work_sessions WHERE teacher_id = ? AND ended_at IS NULL").get(uid);
  const running = runningRow ? shape(runningRow, now) : null;

  // Shifts either side of today: the next fortnight to show, and the past
  // fortnight to catch anything they didn't clock in for.
  const shiftRows = db
    .prepare(
      `SELECT s.*, w.id AS session_id
       FROM shifts s LEFT JOIN work_sessions w ON w.shift_id = s.id
       WHERE s.teacher_id = ? AND s.date BETWEEN ? AND ?
       ORDER BY s.starts_at ASC`
    )
    .all(uid, addSgDays(today, -14), addSgDays(today, 14))
    .map(shapeShift);

  const todayShifts = shiftRows.filter((s) => s.date === today && s.status === "planned");
  // What a clock-in right now would attach to — so the button can name the
  // class rather than being a generic tap.
  const nextShift =
    matchShift(todayShifts, now) ||
    shiftRows.find((s) => s.status === "planned" && !s.sessionId && new Date(s.startsAt) > new Date(now)) ||
    null;

  const upcoming = shiftRows
    .filter((s) => s.status === "planned" && new Date(s.endsAt) > new Date(now))
    .slice(0, 8);

  // Past shifts with no clock-in and no explanation yet — the prompt that
  // replaces the IT Head's weekly chase.
  const missed = shiftRows.filter((s) => isMissed(s, now, !!s.sessionId) && !s.missedReason);
  const awaiting = shiftRows.filter((s) => s.missedReason && !s.resolution);

  // The session the teacher is on right now, if any.
  const onShiftRow = db
    .prepare(
      `SELECT * FROM work_sessions
       WHERE teacher_id = ? AND shift_id IS NOT NULL AND clock_in_at IS NOT NULL
         AND started_at <= ? AND ended_at > ?
       ORDER BY started_at ASC LIMIT 1`
    )
    .get(uid, now, now);
  const onShift = onShiftRow ? shape(onShiftRow, now) : null;

  // This month's finished work. A rostered session carries a FUTURE ended_at
  // for the whole shift, so "has an end time" is no longer "has happened".
  const sessions = db
    .prepare(
      "SELECT * FROM work_sessions WHERE teacher_id = ? AND ended_at IS NOT NULL AND ended_at <= ? ORDER BY started_at DESC"
    )
    .all(uid, now)
    .filter((r) => sgMonth(r.started_at) === month)
    .map((r) => shape(r, now));

  // Month totals (exclude rejected). Approved pay uses the snapshotted rate and
  // holiday multiplier; pending pay is an estimate at today's.
  let teachingMinutes = 0;
  let otMinutes = 0;
  let approvedCents = 0;
  let pendingCents = 0;
  for (const s of sessions) {
    if (s.status === "rejected") continue;
    if (s.category === "ot") otMinutes += s.minutes;
    else teachingMinutes += s.minutes;
    const approved = s.status === "approved";
    const rDollars = approved && s.rateCents != null ? s.rateCents / 100 : rateFor(s.category, prof.pay_tier);
    const mult = approved ? s.phMultiplier : s.phName ? PH_MULTIPLIER : null;
    const cents = sessionPayCents(s.minutes, rDollars, mult);
    if (approved) approvedCents += cents;
    else pendingCents += cents;
  }

  return (
    <HoursApp
      firstName={session.fullName ? session.fullName.split(" ")[0] : "there"}
      payTier={prof.pay_tier || null}
      tierRate={tierRate}
      monthName={monthLabel(month)}
      branchOptions={branchOptions}
      running={running}
      onShift={onShift}
      nextShift={nextShift}
      upcoming={upcoming}
      missed={missed}
      awaiting={awaiting}
      sessions={sessions}
      totals={{ teachingMinutes, otMinutes, approvedCents, pendingCents }}
    />
  );
}

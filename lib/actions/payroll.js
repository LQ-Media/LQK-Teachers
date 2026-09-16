"use server";

// The monthly payroll report — the thing that replaces the Sling export, the
// paste into Google Sheets, and the tally by hand.
//
// It reads SHIFTS, not sessions, which is the opposite of the older
// hoursAdminData/export path and is deliberate. The report has to show the
// shifts nobody clocked in for: those are exactly the rows an IT Head needs to
// see before payroll closes, and a session-driven query cannot show them
// because there is no session to find.
//
// The pure aggregation lives in lib/hours/report.js. This file is only the
// query, the period plumbing, and the guard.

import { requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { periodByKey, periodFor, isPastCutOff, cutOffInstant } from "@/lib/hours/periods";
import { periodReport, exceptions } from "@/lib/hours/report";
import { sgToday, sgDate } from "@/lib/hours/rates";

function clean(v) {
  return String(v ?? "").trim();
}

// Shifts joined to whichever session fulfilled them. LEFT JOIN so an unworked
// shift still appears — see the note at the top.
const REPORT_SQL = `
  SELECT s.*, p.full_name AS teacher_name, p.pay_tier AS pay_tier,
         w.clock_in_at AS clock_in_at
  FROM shifts s
  JOIN profiles p ON p.id = s.teacher_id
  LEFT JOIN work_sessions w ON w.shift_id = s.id AND w.status != 'rejected'
  WHERE s.date BETWEEN ? AND ?
  ORDER BY p.full_name ASC, s.starts_at ASC
`;

/**
 * Everything payroll needs for one published period.
 *
 * FUTURE SHIFTS ARE EXCLUDED. A period usually closes a few days after it ends,
 * so a report pulled mid-period would otherwise carry classes that have not been
 * taught yet — and every one of them would read as "no clock-in", burying the
 * real exceptions under a list of things that simply have not happened. Only
 * shifts whose end has passed are counted, which is the same `ended_at <= now`
 * discipline the session readers use.
 */
export async function payrollReport(periodKey) {
  await requireRole(["admin"]);
  const db = getDb();
  const now = new Date().toISOString();

  const period = periodByKey(clean(periodKey)) || periodFor(sgToday());
  if (!period) {
    return {
      error:
        "Today isn’t inside any published payroll period. Add the year’s cut-off dates before running a report.",
      period: null,
      blocks: [],
    };
  }

  const rows = db
    .prepare(REPORT_SQL)
    .all(period.from, period.to)
    .map((r) => ({
      id: r.id,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      payTier: r.pay_tier || null,
      category: r.category,
      otRole: r.ot_role || null,
      branch: r.branch || null,
      status: r.status,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      clockInAt: r.clock_in_at || null,
      note: r.note || null,
    }))
    .filter((s) => new Date(s.endsAt) <= new Date(now));

  const blocks = periodReport(rows, period);

  return {
    period,
    blocks,
    exceptions: exceptions(blocks),
    cutOff: cutOffInstant(period),
    pastCutOff: isPastCutOff(period, now),
    // What "up to" means on screen. Without it a half-finished period looks
    // like a finished one that happens to be short.
    countedTo: sgDate(now) < period.to ? sgDate(now) : period.to,
    // The top line sums the ROUNDED per-teacher figures, not the rounding of
    // the summed minutes. That is deliberate: payroll pays each teacher their
    // own rounded hours, so the total that matters is the sum of what will
    // actually be paid. Rounding the grand total instead would produce a
    // headline figure that no set of payslips adds up to.
    totals: blocks.reduce(
      (a, b) => ({
        teachingHours: a.teachingHours + b.teachingHours,
        otHours: a.otHours + b.otHours,
        trackedHours: a.trackedHours + b.trackedHours,
        flagged: a.flagged + b.flaggedCount,
      }),
      { teachingHours: 0, otHours: 0, trackedHours: 0, flagged: 0 }
    ),
  };
}

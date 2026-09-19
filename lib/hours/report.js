// The monthly payroll report — the thing that replaces the Sling export, the
// paste into Google Sheets, and the tally by hand.
//
// The column set is deliberately the one already in use in the "Teachers hours
// for payroll" sheet, so the output can be checked line-for-line against a
// month that was done the old way:
//
//   EMPLOYEE · DATE · POSITIONS · SCH. SHIFT START · SCH. SHIFT END ·
//   SHIFT DURATION · SCH. SHIFT DURATION · DIFFERENCE · NOTES
//
// plus, per teacher, TOTAL TEACHING HOURS (hr) and TOTAL OT HOURS (hr).
//
// SHIFT DURATION is what is PAYABLE (see attendance.js: scheduled start or the
// clock-in if later, through to the scheduled end). SCH. SHIFT DURATION is what
// was rostered. DIFFERENCE is the gap between them, and it is the column an IT
// Head reads to see how late somebody was.
//
// One property worth knowing: under the current rules DIFFERENCE can only be
// zero or negative on its own. Early clock-ins no longer pay, so the only way
// to see a positive number is an IT Head having adjusted the times by hand —
// which makes a positive DIFFERENCE a useful signal rather than noise.
//
// Pure — no DB, no server imports.

import {
  OT_ROLE_BY_KEY,
  TIER_BY_KEY,
  isTrackedOnly,
  minutesBetween,
  payrollHours,
  sgDate,
  sgMonth,
  sgTime24,
} from "./rates.js";
import { attendanceOf, payableWindow } from "./attendance.js";

/** The label the report prints in the POSITIONS column. */
export function positionLabel(shift) {
  if (shift.category === "ot") {
    return OT_ROLE_BY_KEY[shift.otRole]?.label || "OT";
  }
  return TIER_BY_KEY[shift.payTier]?.label || "Teacher";
}

/**
 * One report row per shift.
 *
 * `shift` is expected to carry the teacher's name and pay tier already joined
 * on, plus `clockInAt` (rounded) and `note`. Cancelled shifts are dropped: they
 * were never worked and they would pad every teacher's block.
 */
export function reportRow(shift) {
  const scheduledMinutes = minutesBetween(shift.startsAt, shift.endsAt);
  const window = payableWindow(shift, shift.clockInAt);
  const payableMinutes = window ? window.minutes : 0;
  const attendance = attendanceOf(shift, shift.clockInAt);

  return {
    shiftId: shift.id,
    teacherId: shift.teacherId,
    employee: shift.teacherName || "",
    date: sgDate(shift.startsAt),
    position: positionLabel(shift),
    category: shift.category,
    otRole: shift.otRole || null,
    trackedOnly: shift.category === "ot" && isTrackedOnly(shift.otRole),
    schStart: sgTime24(shift.startsAt),
    schEnd: sgTime24(shift.endsAt),
    clockIn: shift.clockInAt ? sgTime24(shift.clockInAt) : null,
    scheduledMinutes,
    payableMinutes,
    // Sling's sign convention: negative means short of the roster.
    differenceMinutes: payableMinutes - scheduledMinutes,
    attendance: attendance.state,
    lateMinutes: attendance.lateMinutes,
    flagged: attendance.flagged,
    note: shift.note || "",
  };
}

/**
 * Which shifts a report covers.
 *
 * A payroll PERIOD ({from, to}) is the real unit — see periods.js, LQK's runs
 * are not calendar months. A "YYYY-MM" string is still accepted because a
 * calendar month is what you want when reconciling against a Sling export,
 * which is monthly. Nothing means everything passed in.
 */
function rangeTest(range) {
  if (!range) return () => true;
  if (typeof range === "string") return (iso) => sgMonth(iso) === range;
  const { from, to } = range;
  return (iso) => {
    const d = sgDate(iso);
    return (!from || d >= from) && (!to || d <= to);
  };
}

/**
 * Group a payroll period's shifts into the per-teacher blocks the payroll
 * sheet uses.
 *
 * The three totals are kept apart on purpose:
 *
 *   teachingHours — paid at the teacher's tier
 *   otHours       — paid at the flat OT rate (plain OT, curriculum, events,
 *                   logistics)
 *   trackedHours  — mentoring and IT, logged for the record and NOT PAID
 *
 * trackedHours is excluded from otHours rather than folded into it. Putting
 * unpaid hours into a payroll total is exactly the kind of quiet error this
 * report exists to remove: it would pay salaried staff twice.
 *
 * Rounding happens here, once, on each total — never on the individual rows.
 */
export function buildReport(shifts, range) {
  const inRange = rangeTest(range);
  const byTeacher = new Map();

  for (const shift of shifts || []) {
    if (!shift || shift.status === "cancelled") continue;
    if (!inRange(shift.startsAt)) continue;

    const row = reportRow(shift);
    let block = byTeacher.get(row.teacherId);
    if (!block) {
      block = {
        teacherId: row.teacherId,
        employee: row.employee,
        rows: [],
        teachingMinutes: 0,
        otMinutes: 0,
        trackedMinutes: 0,
        flaggedCount: 0,
      };
      byTeacher.set(row.teacherId, block);
    }

    block.rows.push(row);
    if (row.category === "ot") {
      if (row.trackedOnly) block.trackedMinutes += row.payableMinutes;
      else block.otMinutes += row.payableMinutes;
    } else {
      block.teachingMinutes += row.payableMinutes;
    }
    if (row.flagged) block.flaggedCount += 1;
  }

  return [...byTeacher.values()]
    .map((block) => ({
      ...block,
      rows: block.rows.sort((a, b) => a.date.localeCompare(b.date) || a.schStart.localeCompare(b.schStart)),
      teachingHours: payrollHours(block.teachingMinutes),
      otHours: payrollHours(block.otMinutes),
      trackedHours: payrollHours(block.trackedMinutes),
    }))
    .sort((a, b) => (a.employee || "").localeCompare(b.employee || ""));
}

const CSV_HEADERS = [
  "EMPLOYEE",
  "DATE",
  "POSITIONS",
  "SCH. SHIFT START",
  "SCH. SHIFT END",
  "CLOCK IN TIME",
  "SHIFT DURATION",
  "SCH. SHIFT DURATION",
  "DIFFERENCE",
  "TOTAL OT HOURS (hr)",
  "TOTAL TEACHING HOURS (hr)",
  "NOTES",
];

/** "7h 25min", "45min", or "-" for nothing. Sling's own spelling. */
export function formatDuration(minutes) {
  const m = Math.round(minutes || 0);
  if (!m) return "-";
  const sign = m < 0 ? "-" : "";
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  if (!h) return `${sign}${mm}min`;
  if (!mm) return `${sign}${h}h`;
  return `${sign}${h}h ${mm}min`;
}

function csvCell(value) {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The report as CSV, in the sheet's own shape: a blank-dated subtotal row per
 * teacher carrying the two totals, then that teacher's shifts. Matching the
 * existing layout means a month can be diffed against one done by hand.
 */
export function reportCsv(blocks) {
  const lines = [CSV_HEADERS.join(",")];

  for (const block of blocks || []) {
    lines.push(
      [
        block.employee,
        "",
        "",
        "",
        "",
        "",
        formatDuration(block.teachingMinutes + block.otMinutes + block.trackedMinutes),
        "",
        "",
        block.otHours,
        block.teachingHours,
        block.trackedMinutes ? `Tracked, unpaid: ${formatDuration(block.trackedMinutes)}` : "",
      ]
        .map(csvCell)
        .join(",")
    );

    for (const row of block.rows) {
      lines.push(
        [
          row.employee,
          row.date,
          row.position,
          row.schStart,
          row.schEnd,
          row.clockIn || "-",
          formatDuration(row.payableMinutes),
          formatDuration(row.scheduledMinutes),
          row.differenceMinutes ? formatDuration(row.differenceMinutes) : "",
          "",
          "",
          row.note,
        ]
          .map(csvCell)
          .join(",")
      );
    }
  }

  return lines.join("\n");
}

/**
 * A calendar month, for reconciling against a Sling export. Payroll itself
 * should go through a period — see buildReport's `range`.
 */
export function monthlyReport(shifts, month) {
  return buildReport(shifts, month);
}

/** A published payroll period: the one payroll actually runs on. */
export function periodReport(shifts, period) {
  return buildReport(shifts, period ? { from: period.from, to: period.to } : null);
}

/** Every flagged shift in the report, for the IT Heads' weekly chase. */
export function exceptions(blocks) {
  return (blocks || [])
    .flatMap((block) => block.rows.filter((r) => r.flagged))
    .sort((a, b) => a.date.localeCompare(b.date) || a.employee.localeCompare(b.employee));
}

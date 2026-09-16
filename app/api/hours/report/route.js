import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { periodByKey, periodFor } from "@/lib/hours/periods";
import { periodReport, reportCsv } from "@/lib/hours/report";
import { sgToday } from "@/lib/hours/rates";

// GET /api/hours/report?period=YYYY-MM
//
// The payroll report as CSV, in the same column order as the "Teachers hours
// for payroll" sheet, so a period can be diffed against one done by hand.
//
// A PERIOD, not a month: LQK's runs are irregular and published annually — see
// lib/hours/periods.js. August pay covers 27 July to 23 August.
//
// `/api` is not behind the page proxy, so this gates on the session directly.
export async function GET(request) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });
  if (session.role !== "admin") return new Response("Forbidden", { status: 403 });

  const key = request.nextUrl.searchParams.get("period") || "";
  const period = periodByKey(key) || periodFor(sgToday());
  if (!period) {
    return new Response("No published payroll period covers that date.", { status: 400 });
  }

  const db = getDb();
  const now = new Date().toISOString();

  // Same discipline as every other payroll reader: a shift that has not
  // finished has not been worked, and must not be exported as if it had.
  const rows = db
    .prepare(
      `SELECT s.*, p.full_name AS teacher_name, p.pay_tier AS pay_tier, w.clock_in_at AS clock_in_at
       FROM shifts s
       JOIN profiles p ON p.id = s.teacher_id
       LEFT JOIN work_sessions w ON w.shift_id = s.id AND w.status != 'rejected'
       WHERE s.date BETWEEN ? AND ?
       ORDER BY p.full_name ASC, s.starts_at ASC`
    )
    .all(period.from, period.to)
    .map((r) => ({
      id: r.id,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      payTier: r.pay_tier || null,
      category: r.category,
      otRole: r.ot_role || null,
      status: r.status,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      clockInAt: r.clock_in_at || null,
      note: r.note || null,
    }))
    .filter((s) => new Date(s.endsAt) <= new Date(now));

  const csv = reportCsv(periodReport(rows, period));

  // The BOM is for Excel, which otherwise reads a UTF-8 CSV as Latin-1 and
  // mangles every teacher's name that carries an apostrophe or a diacritic.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lqk-payroll-${period.key}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

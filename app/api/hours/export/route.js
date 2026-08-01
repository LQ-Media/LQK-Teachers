import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import {
  sgMonth,
  sgDate,
  sgTime24,
  minutesBetween,
  decimalHours,
  payCents,
  rateFor,
  monthLabel,
} from "@/lib/hours/rates";

// GET /api/hours/export?month=YYYY-MM
// Admin-only CSV of every completed, non-rejected session in the month — one
// line per session for payroll. `/api` isn't behind the page proxy, so this
// gates on the session directly.
export async function GET(request) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });
  if (session.role !== "admin") return new Response("Forbidden", { status: 403 });

  const month = request.nextUrl.searchParams.get("month") || sgMonth(new Date().toISOString());
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT w.*, p.full_name AS teacher_name, p.pay_tier AS pay_tier
       FROM work_sessions w JOIN profiles p ON p.id = w.teacher_id
       WHERE w.ended_at IS NOT NULL AND w.status != 'rejected'
       ORDER BY p.full_name ASC, w.started_at ASC`
    )
    .all()
    .filter((r) => sgMonth(r.started_at) === month);

  const header = ["Teacher", "Date", "Start", "End", "Type", "Detail", "Branch", "Hours", "Rate ($/hr)", "Pay ($)", "Status"];
  const lines = [header];

  for (const r of rows) {
    const minutes = minutesBetween(r.started_at, r.ended_at);
    const rate = r.status === "approved" && r.rate_cents != null ? r.rate_cents / 100 : rateFor(r.category, r.pay_tier);
    const cents = payCents(minutes, rate);
    lines.push([
      r.teacher_name,
      sgDate(r.started_at),
      sgTime24(r.started_at),
      sgTime24(r.ended_at),
      r.category === "ot" ? "Ad-hoc / OT" : "Class teaching",
      r.category === "ot" ? r.ot_reason || "" : "",
      r.branch || "",
      decimalHours(minutes).toFixed(2),
      rate != null ? rate.toFixed(2) : "",
      rate != null ? (cents / 100).toFixed(2) : "",
      r.status === "approved" ? "Approved" : "Pending",
    ]);
  }

  const csv = lines.map((cols) => cols.map(csvCell).join(",")).join("\r\n");
  const filename = `lqk-hours-${month}.csv`;

  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

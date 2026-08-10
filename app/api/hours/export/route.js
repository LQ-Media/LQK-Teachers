import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import {
  sgMonth,
  sgDate,
  sgTime24,
  minutesBetween,
  decimalHours,
  sessionPayCents,
  rateFor,
  PH_MULTIPLIER,
} from "@/lib/hours/rates";
import { formatAccuracy, formatCoords, mapsUrl } from "@/lib/hours/geo";

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

  // `ended_at <= now`, not merely "not null": a rostered session exists from the
  // moment someone clocks in and carries its shift's FUTURE end. Exporting on
  // the 20th would otherwise pay out the rest of the month.
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT w.*, p.full_name AS teacher_name, p.pay_tier AS pay_tier
       FROM work_sessions w JOIN profiles p ON p.id = w.teacher_id
       WHERE w.ended_at IS NOT NULL AND w.ended_at <= ? AND w.status != 'rejected'
       ORDER BY p.full_name ASC, w.started_at ASC`
    )
    .all(now)
    .filter((r) => sgMonth(r.started_at) === month);

  // Location columns are blank for any session the teacher didn't tag, which is
  // most of them — the stamp is optional.
  //
  // Columns are only ever APPENDED. Payroll opens this in a sheet, and inserting
  // a column mid-row would silently shift everything downstream of it.
  const header = [
    "Teacher",
    "Date",
    "Start",
    "End",
    "Type",
    "Detail",
    "Branch",
    "Hours",
    "Rate ($/hr)",
    "Pay ($)",
    "Status",
    "Tagged location",
    "Coordinates",
    "Accuracy",
    "Map link",
    // Rostered-shift audit trail.
    "Clocked in at",
    "Tapped out at",
    "Source",
    "Public holiday",
    "PH multiplier",
  ];
  const lines = [header];

  const SOURCES = {
    clock_in: "Clocked in",
    unscheduled: "Unscheduled",
    admin_ot: "Entered by admin",
    missed_accepted: "Missed — accepted",
    legacy: "",
  };

  for (const r of rows) {
    const minutes = minutesBetween(r.started_at, r.ended_at);
    const approved = r.status === "approved";
    const rate = approved && r.rate_cents != null ? r.rate_cents / 100 : rateFor(r.category, r.pay_tier);
    // Approved rows pay their snapshot; pending rows are estimated at today's
    // multiplier, matching what the admin screen shows.
    const mult = approved ? r.ph_multiplier : r.ph_name ? PH_MULTIPLIER : null;
    const cents = sessionPayCents(minutes, rate, mult);
    const tagged = r.geo_lat != null && r.geo_lng != null;
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
      approved ? "Approved" : "Pending",
      tagged ? r.geo_label || "" : "",
      tagged ? formatCoords(r.geo_lat, r.geo_lng) : "",
      tagged ? formatAccuracy(r.geo_accuracy) : "",
      tagged ? mapsUrl(r.geo_lat, r.geo_lng) : "",
      // Start/End above are the ROSTERED window, which is what pays. This is
      // when they actually tapped — the two differing is normal, not an error.
      r.clock_in_at ? sgTime24(r.clock_in_at) : "",
      r.clock_out_at ? sgTime24(r.clock_out_at) : "",
      SOURCES[r.source] ?? r.source ?? "",
      r.ph_name || "",
      mult != null ? String(mult) : "",
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

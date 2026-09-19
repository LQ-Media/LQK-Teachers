import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { CRITERION_BY_KEY, LEVEL_BY_NUMBER } from "@/lib/assess/rubric";
import { currentPeriod } from "@/lib/assess/periods";

// GET /api/assessments/export?year=YYYY
// Admin-only CSV, one line per scored criterion, plus one line per assessment
// carrying the overall note (criterion blank) so nothing on file is lost in
// the sheet. Gated on the session directly: /api is outside the page proxy.
//
// Results are FULL-ADMIN ONLY, the same bar as the Assessments tab. A centre IT
// Head also holds role='admin', so a role check alone would let them read every
// teacher's scores — the same leak the payroll routes had. The scope is read
// from the DATABASE, not the JWT, so withdrawing it takes effect at once.
function isFullAdmin(userId) {
  if (!userId) return false;
  const row = getDb().prepare("SELECT role, admin_scope FROM profiles WHERE id = ?").get(userId);
  return !!row && row.role === "admin" && row.admin_scope === "full";
}

export async function GET(request) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });
  if (!isFullAdmin(session.userId)) return new Response("Forbidden", { status: 403 });

  const year = Number(request.nextUrl.searchParams.get("year")) || currentPeriod().year;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.year, a.semester, a.observed_on, a.class_label, a.status, a.submitted_at, a.overall_note, a.rubric_version,
              t.full_name AS teacher, t.primary_location AS branch, t.position, t.pay_tier,
              q.full_name AS assessor
         FROM assessments a
         JOIN profiles t ON t.id = a.teacher_id
         LEFT JOIN profiles q ON q.id = a.assessor_id
        WHERE a.year = ?
        ORDER BY t.full_name, a.observed_on, a.created_at`
    )
    .all(year);
  const scoreStmt = db.prepare("SELECT criterion_key, level, note FROM assessment_scores WHERE assessment_id = ? ORDER BY criterion_key");
  const reviewStmt = db.prepare("SELECT reviewed_on, note FROM assessment_reviews WHERE teacher_id = (SELECT teacher_id FROM assessments WHERE id = ?) AND year = ?");

  // Columns are only ever APPENDED, same rule as the payroll CSV.
  const header = [
    "Teacher",
    "Branch",
    "Position",
    "Tier",
    "Year",
    "Semester",
    "Observed on",
    "Class",
    "Assessor",
    "Status",
    "Submitted at",
    "Rubric version",
    "Criterion",
    "Criterion name",
    "Skill",
    "Level",
    "Level name",
    "Note",
    "Overall note",
    "Verbal review on",
    "Verbal review note",
  ];
  const lines = [header];
  for (const a of rows) {
    const review = reviewStmt.get(a.id, year);
    const base = [
      a.teacher,
      a.branch || "",
      a.position || "",
      a.pay_tier || "",
      a.year,
      a.semester,
      a.observed_on,
      a.class_label || "",
      a.assessor || "",
      a.status,
      a.submitted_at || "",
      a.rubric_version,
    ];
    const tail = [a.overall_note || "", review?.reviewed_on || "", review?.note || ""];
    const scores = scoreStmt.all(a.id);
    if (!scores.length) lines.push([...base, "", "", "", "", "", "", ...tail]);
    for (const s of scores) {
      const c = CRITERION_BY_KEY[s.criterion_key];
      lines.push([
        ...base,
        s.criterion_key,
        c?.name || "",
        c?.skill ?? "",
        s.level,
        LEVEL_BY_NUMBER[s.level]?.name || "",
        s.note || "",
        ...tail,
      ]);
    }
  }

  const csv = lines.map((cols) => cols.map(csvCell).join(",")).join("\r\n");
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="lqk-assessments-${year}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

import "server-only";
import { getDb } from "@/lib/db";
import { avatarSrc } from "@/lib/avatar";
import { CRITERIA, RUBRIC_VERSION } from "./rubric";
import { annualView, atBarCount } from "./rules";
import { deadlineStatus, periodShort } from "./periods";
import { TARGET_LEVEL } from "./rubric";
import { sgToday } from "@/lib/hours/rates";

/**
 * Read-side helpers for the assessment screens. Server-only, no "use server":
 * these are plain functions a page or an action calls, never something a
 * client can invoke directly.
 */

/** Everyone who could be assessed, for the picker. Any branch, by decision. */
export function assessableTeachers(excludeId) {
  return getDb()
    .prepare(
      `SELECT id, full_name, primary_location, position, pay_tier, photo
         FROM profiles WHERE id != ? ORDER BY full_name`
    )
    .all(excludeId)
    .map((p) => ({
      id: p.id,
      fullName: p.full_name,
      branch: p.primary_location || "",
      position: p.position || "",
      avatar: avatarSrc(p.id, p.photo),
    }));
}

/** Has `teacherId` SUBMITTED an assessment of `assessorId` in this period? */
export function reciprocalExists({ assessorId, teacherId, year, semester }) {
  return !!getDb()
    .prepare(
      `SELECT 1 FROM assessments
        WHERE teacher_id = ? AND assessor_id = ? AND year = ? AND semester = ? AND status = 'submitted'
        LIMIT 1`
    )
    .get(assessorId, teacherId, year, semester);
}

/** An assessor's own list: drafts first, then submitted, newest first. */
export function assessmentsByAssessor(assessorId, year) {
  return getDb()
    .prepare(
      `SELECT a.id, a.teacher_id, a.year, a.semester, a.observed_on, a.class_label, a.status, a.submitted_at,
              p.full_name AS teacher_name, p.primary_location AS teacher_branch,
              (SELECT COUNT(*) FROM assessment_scores s WHERE s.assessment_id = a.id) AS scored
         FROM assessments a JOIN profiles p ON p.id = a.teacher_id
        WHERE a.assessor_id = ? AND a.year = ?
        ORDER BY CASE a.status WHEN 'draft' THEN 0 ELSE 1 END, a.observed_on DESC, a.created_at DESC`
    )
    .all(assessorId, year)
    .map(rowToSummary);
}

function rowToSummary(r) {
  return {
    id: r.id,
    teacherId: r.teacher_id,
    teacherName: r.teacher_name,
    teacherBranch: r.teacher_branch || "",
    assessorName: r.assessor_name || "",
    year: r.year,
    semester: r.semester,
    period: periodShort(r.year, r.semester),
    observedOn: r.observed_on,
    classLabel: r.class_label || "",
    status: r.status,
    submittedAt: r.submitted_at,
    scored: r.scored ?? 0,
    total: CRITERIA.length,
  };
}

/**
 * One assessment with its scores and evidence. `viewer` decides what comes
 * back: the assessor who owns it or an admin gets everything; anyone else
 * gets null — including the teacher it is about.
 */
export function assessmentDetail(id, viewer) {
  const db = getDb();
  const a = db
    .prepare(
      `SELECT a.*, p.full_name AS teacher_name, p.primary_location AS teacher_branch, p.position AS teacher_position,
              p.photo AS teacher_photo, q.full_name AS assessor_name
         FROM assessments a
         JOIN profiles p ON p.id = a.teacher_id
         LEFT JOIN profiles q ON q.id = a.assessor_id
        WHERE a.id = ?`
    )
    .get(id);
  if (!a) return null;
  const isOwner = a.assessor_id === viewer.userId;
  const isAdmin = viewer.role === "admin";
  if (!isOwner && !isAdmin) return null;

  const scores = {};
  for (const s of db.prepare("SELECT criterion_key, level, note FROM assessment_scores WHERE assessment_id = ?").all(id)) {
    scores[s.criterion_key] = { level: s.level, note: s.note || "" };
  }
  const evidence = db
    .prepare(
      `SELECT e.id, e.kind, e.label, e.criterion_key, e.mime, e.bytes, e.thumb, e.created_at, e.uploaded_by,
              u.full_name AS uploader_name
         FROM assessment_evidence e LEFT JOIN profiles u ON u.id = e.uploaded_by
        WHERE e.assessment_id = ? ORDER BY e.created_at ASC`
    )
    .all(id)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label || "",
      criterionKey: e.criterion_key || "",
      mime: e.mime || "",
      bytes: e.bytes || 0,
      thumb: e.thumb || "",
      createdAt: e.created_at,
      uploaderName: e.uploader_name || "",
      // Only the uploader and admins may open it; the row tells the UI whether
      // to render a link or just the thumbnail.
      canOpen: isAdmin || e.uploaded_by === viewer.userId,
    }));

  return {
    id: a.id,
    teacher: {
      id: a.teacher_id,
      fullName: a.teacher_name,
      branch: a.teacher_branch || "",
      position: a.teacher_position || "",
      avatar: avatarSrc(a.teacher_id, a.teacher_photo),
    },
    assessorId: a.assessor_id,
    assessorName: a.assessor_name || "",
    year: a.year,
    semester: a.semester,
    period: periodShort(a.year, a.semester),
    observedOn: a.observed_on,
    classLabel: a.class_label || "",
    status: a.status,
    overallNote: a.overall_note || "",
    rubricVersion: a.rubric_version,
    submittedAt: a.submitted_at,
    scores,
    evidence,
    isOwner,
    isAdmin,
    // A draft is edited by its owner only; an admin may read it and delete it.
    canEdit: isOwner && a.status === "draft",
    outdatedRubric: a.rubric_version !== RUBRIC_VERSION,
  };
}

/** Distinct years with any assessment, for the admin year picker. */
export function yearsWithAssessments() {
  return getDb()
    .prepare("SELECT DISTINCT year FROM assessments ORDER BY year DESC")
    .all()
    .map((r) => r.year);
}

/**
 * The admin picture for one year: every teacher, their submitted assessments
 * per semester, their standing against the November rule, the verbal review
 * if logged, and the per-criterion annual view.
 *
 * Every account is listed, admins included — an admin who also teaches is
 * assessed like anyone else. Accounts created after the deadline are still
 * shown; the tracker is a list to work through, not a verdict.
 */
export function adminYearData(year, today = sgToday()) {
  const db = getDb();
  const people = db
    .prepare("SELECT id, full_name, primary_location, position, pay_tier, photo, is_assessor, role FROM profiles ORDER BY full_name")
    .all();
  const rows = db
    .prepare(
      `SELECT a.id, a.teacher_id, a.assessor_id, a.year, a.semester, a.observed_on, a.class_label, a.status, a.submitted_at,
              a.overall_note, q.full_name AS assessor_name
         FROM assessments a LEFT JOIN profiles q ON q.id = a.assessor_id
        WHERE a.year = ? ORDER BY a.observed_on ASC, a.created_at ASC`
    )
    .all(year);
  const scoreRows = db
    .prepare(
      `SELECT s.assessment_id, s.criterion_key, s.level, s.note
         FROM assessment_scores s JOIN assessments a ON a.id = s.assessment_id WHERE a.year = ?`
    )
    .all(year);
  const scoresByAssessment = new Map();
  for (const s of scoreRows) {
    if (!scoresByAssessment.has(s.assessment_id)) scoresByAssessment.set(s.assessment_id, []);
    scoresByAssessment.get(s.assessment_id).push({ key: s.criterion_key, level: s.level, note: s.note || "" });
  }
  const reviews = new Map(
    db
      .prepare(
        `SELECT r.teacher_id, r.reviewed_on, r.note, p.full_name AS reviewer_name
           FROM assessment_reviews r LEFT JOIN profiles p ON p.id = r.reviewed_by WHERE r.year = ?`
      )
      .all(year)
      .map((r) => [r.teacher_id, { reviewedOn: r.reviewed_on, note: r.note || "", reviewerName: r.reviewer_name || "" }])
  );

  const byTeacher = new Map();
  for (const r of rows) {
    if (!byTeacher.has(r.teacher_id)) byTeacher.set(r.teacher_id, []);
    byTeacher.get(r.teacher_id).push({
      id: r.id,
      assessorId: r.assessor_id,
      assessorName: r.assessor_name || "",
      semester: r.semester,
      observedOn: r.observed_on,
      classLabel: r.class_label || "",
      status: r.status,
      submittedAt: r.submitted_at,
      overallNote: r.overall_note || "",
      scores: scoresByAssessment.get(r.id) || [],
    });
  }

  const teachers = people.map((p) => {
    const all = byTeacher.get(p.id) || [];
    const submitted = all.filter((a) => a.status === "submitted");
    const view = annualView(submitted);
    const bar = atBarCount(view, TARGET_LEVEL);
    return {
      id: p.id,
      fullName: p.full_name,
      branch: p.primary_location || "",
      position: p.position || "",
      role: p.role,
      isAssessor: !!p.is_assessor,
      avatar: avatarSrc(p.id, p.photo),
      assessments: all,
      submittedCount: submitted.length,
      s1Count: submitted.filter((a) => a.semester === 1).length,
      s2Count: submitted.filter((a) => a.semester === 2).length,
      deadline: deadlineStatus({ today, year, hasAssessment: submitted.length > 0 }),
      review: reviews.get(p.id) || null,
      view,
      atBar: bar.atBar,
      scoredCriteria: bar.scored,
    };
  });

  const assessors = people
    .filter((p) => p.is_assessor || p.role === "admin")
    .map((p) => ({ id: p.id, fullName: p.full_name, branch: p.primary_location || "" }));

  return {
    year,
    today,
    target: TARGET_LEVEL,
    teachers,
    assessors,
    counts: {
      teachers: teachers.length,
      done: teachers.filter((t) => t.deadline === "done").length,
      chase: teachers.filter((t) => t.deadline === "chase").length,
      missed: teachers.filter((t) => t.deadline === "missed").length,
      drafts: rows.filter((r) => r.status === "draft").length,
      submitted: rows.filter((r) => r.status === "submitted").length,
    },
  };
}

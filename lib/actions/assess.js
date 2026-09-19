"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAssessor, requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { RUBRIC_VERSION } from "@/lib/assess/rubric";
import { canAssess, validateScores, canSubmit } from "@/lib/assess/rules";
import { periodFor, isDateString, currentPeriod } from "@/lib/assess/periods";
import { reciprocalExists, adminYearData } from "@/lib/assess/queries";
import { sgToday } from "@/lib/hours/rates";

function clean(v, max = 300) {
  return String(v ?? "").trim().slice(0, max);
}

function loadOwned(db, id, session) {
  const a = db.prepare("SELECT * FROM assessments WHERE id = ?").get(String(id || ""));
  if (!a) return { error: "That assessment no longer exists." };
  if (a.assessor_id !== session.userId && session.role !== "admin") return { error: "Not yours to change." };
  return { a };
}

/**
 * Open a new draft. The period is taken from the observation date, never
 * from today, so an assessor writing up Tuesday's lesson on Thursday files it
 * under the right semester even across the June/July boundary.
 */
export async function startAssessment(input) {
  const session = await requireAssessor();
  const db = getDb();

  const teacherId = clean(input?.teacherId, 64);
  const observedOn = isDateString(input?.observedOn) ? input.observedOn : sgToday();
  const classLabel = clean(input?.classLabel, 120);
  if (observedOn > sgToday()) return { error: "The observation date cannot be in the future." };

  const teacher = db.prepare("SELECT id FROM profiles WHERE id = ?").get(teacherId);
  if (!teacher) return { error: "Choose a teacher." };

  const { year, semester } = periodFor(observedOn);
  const verdict = canAssess({
    assessorId: session.userId,
    teacherId,
    assessorIsAssessor: true,
    reciprocalExists: reciprocalExists({ assessorId: session.userId, teacherId, year, semester }),
  });
  if (!verdict.ok) return { error: verdict.reason };

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO assessments (id, teacher_id, assessor_id, year, semester, observed_on, class_label, status,
       overall_note, rubric_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?)`
  ).run(id, teacherId, session.userId, year, semester, observedOn, classLabel || null, RUBRIC_VERSION, now, now);

  revalidatePath("/assessments");
  return { ok: true, id };
}

/**
 * Save the form as it stands. Called on every change (debounced) so a phone
 * losing signal mid-lesson loses nothing. Replaces the score set wholesale:
 * a criterion the assessor cleared comes back as no row, which is the
 * "not observed" state, not a zero.
 */
export async function saveDraft(input) {
  const session = await requireAssessor();
  const db = getDb();
  const found = loadOwned(db, input?.id, session);
  if (found.error) return found;
  const { a } = found;
  if (a.status !== "draft") return { error: "This assessment has been submitted and can no longer be edited." };
  if (a.assessor_id !== session.userId) return { error: "Only the assessor who opened a draft can edit it." };

  const checked = validateScores(input?.scores);
  if (!checked.ok) return { error: checked.errors.join(" ") };

  const observedOn = isDateString(input?.observedOn) ? input.observedOn : a.observed_on;
  if (observedOn > sgToday()) return { error: "The observation date cannot be in the future." };
  const { year, semester } = periodFor(observedOn);
  // Moving the date across a semester boundary re-runs the reciprocal check,
  // since the rule is per period.
  if (year !== a.year || semester !== a.semester) {
    if (reciprocalExists({ assessorId: session.userId, teacherId: a.teacher_id, year, semester })) {
      return { error: "That date falls in a semester where this teacher assessed you. Pick another date or another assessor." };
    }
  }

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE assessments SET observed_on = ?, year = ?, semester = ?, class_label = ?, overall_note = ?, updated_at = ?
        WHERE id = ?`
    ).run(observedOn, year, semester, clean(input?.classLabel, 120) || null, clean(input?.overallNote, 2000) || null, now, a.id);
    db.prepare("DELETE FROM assessment_scores WHERE assessment_id = ?").run(a.id);
    const ins = db.prepare(
      "INSERT INTO assessment_scores (assessment_id, criterion_key, level, note) VALUES (?, ?, ?, ?)"
    );
    for (const s of checked.scores) {
      if (s.level == null) continue;
      ins.run(a.id, s.key, s.level, s.note || null);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { error: `Couldn't save: ${err.message}` };
  }
  return { ok: true, savedAt: now };
}

/** Lock it. After this only an admin can remove it, and nobody can edit it. */
export async function submitAssessment(input) {
  const session = await requireAssessor();
  const db = getDb();
  // Save whatever is on the form first, so a submit never loses the last edit.
  const saved = await saveDraft(input);
  if (saved.error) return saved;

  const a = db.prepare("SELECT * FROM assessments WHERE id = ?").get(String(input?.id || ""));
  const scores = db.prepare("SELECT criterion_key AS key, level FROM assessment_scores WHERE assessment_id = ?").all(a.id);
  const verdict = canSubmit(scores);
  if (!verdict.ok) return { error: verdict.reason };

  const now = new Date().toISOString();
  db.prepare("UPDATE assessments SET status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'").run(
    now,
    now,
    a.id
  );
  revalidatePath("/assessments");
  revalidatePath(`/assessments/${a.id}`);
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Remove an assessment. The assessor may discard their own DRAFT; only an
 * admin removes a submitted one (and that is logged to the server console,
 * since there is no audit table in this portal).
 */
export async function deleteAssessment(id) {
  const session = await requireAssessor();
  const db = getDb();
  const found = loadOwned(db, id, session);
  if (found.error) return found;
  const { a } = found;
  if (a.status === "submitted" && session.role !== "admin") {
    return { error: "A submitted assessment can only be removed by an admin." };
  }
  if (a.status === "submitted") {
    console.warn(`[assess] admin ${session.userId} deleted submitted assessment ${a.id} of ${a.teacher_id} by ${a.assessor_id}`);
  }
  db.prepare("DELETE FROM assessments WHERE id = ?").run(a.id);
  revalidatePath("/assessments");
  revalidatePath("/admin");
  return { ok: true };
}

/** Admin: record that the year's result was discussed with the teacher. */
export async function logReview(input) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const teacherId = clean(input?.teacherId, 64);
  const year = Number(input?.year);
  const reviewedOn = isDateString(input?.reviewedOn) ? input.reviewedOn : sgToday();
  const note = clean(input?.note, 2000);
  if (!db.prepare("SELECT 1 FROM profiles WHERE id = ?").get(teacherId)) return { error: "Teacher not found." };
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return { error: "Choose a year." };
  if (reviewedOn > sgToday()) return { error: "The review date cannot be in the future." };

  db.prepare(
    `INSERT INTO assessment_reviews (id, teacher_id, year, reviewed_by, reviewed_on, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(teacher_id, year) DO UPDATE SET reviewed_by = excluded.reviewed_by, reviewed_on = excluded.reviewed_on,
       note = excluded.note`
  ).run(randomUUID(), teacherId, year, session.userId, reviewedOn, note || null, new Date().toISOString());
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteReview(input) {
  await requireRole(["admin"]);
  getDb().prepare("DELETE FROM assessment_reviews WHERE teacher_id = ? AND year = ?").run(clean(input?.teacherId, 64), Number(input?.year));
  revalidatePath("/admin");
  return { ok: true };
}

/** Admin: reload the year view without a full page refresh. */
export async function assessmentsAdminData(year) {
  await requireRole(["admin"]);
  const y = Number(year) || currentPeriod().year;
  return adminYearData(y);
}

/**
 * Forget an evidence row. The file itself stays on Drive — the portal never
 * deletes from Karim's Drive, and recordings are kept indefinitely by decision.
 * The uploading assessor may remove one from their own draft; admins always.
 */
export async function deleteEvidence(id) {
  const session = await requireAssessor();
  const db = getDb();
  const e = db
    .prepare(
      `SELECT e.id, e.uploaded_by, a.status FROM assessment_evidence e JOIN assessments a ON a.id = e.assessment_id WHERE e.id = ?`
    )
    .get(String(id || ""));
  if (!e) return { error: "Not found." };
  const isAdmin = session.role === "admin";
  if (!isAdmin && e.uploaded_by !== session.userId) return { error: "Not yours to remove." };
  if (!isAdmin && e.status !== "draft") return { error: "This assessment has been submitted; ask an admin." };
  db.prepare("DELETE FROM assessment_evidence WHERE id = ?").run(e.id);
  return { ok: true };
}

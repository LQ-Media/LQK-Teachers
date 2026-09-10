"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession, canAssessFor } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { parentsConfigured, fetchClasses, sendClassReport, updateChild } from "@/lib/parents/bridge";
import { isDateString } from "@/lib/assess/periods";
import { sgToday } from "@/lib/hours/rates";

function clean(v, max = 300) {
  return String(v ?? "").trim().slice(0, max);
}

/**
 * Whose classes may this session look at?
 *   - everyone: their own (matched on email, then on the name the office typed)
 *   - admins and assessors: anyone's, by passing `teacherId` — an assessor
 *     scores A1 and A2 from exactly this view of the teacher's work
 */
async function scopeFor(session, teacherId) {
  const db = getDb();
  let target = session.userId;
  if (teacherId && teacherId !== session.userId) {
    if (!canAssessFor(session)) throw new Error("You can only see your own classes.");
    target = teacherId;
  }
  const p = db.prepare("SELECT id, full_name, email FROM profiles WHERE id = ?").get(target);
  if (!p) throw new Error("Teacher not found.");
  return { teacherId: p.id, email: p.email, name: p.full_name, own: p.id === session.userId };
}

/** The page's data: classes with children, plus recent reports. */
export async function classesData(teacherId) {
  const session = await requireSession();
  const scope = await scopeFor(session, clean(teacherId, 64));
  const db = getDb();
  const reports = db
    .prepare(
      `SELECT id, parent_class_id, class_name, centre, lesson_date, portion, went, practise, per_child, sent_at, send_error, created_at
         FROM class_reports WHERE teacher_id = ? ORDER BY lesson_date DESC, created_at DESC LIMIT 40`
    )
    .all(scope.teacherId)
    .map(shapeReport);

  if (!parentsConfigured()) {
    return { configured: false, scope, classes: [], reports, error: "" };
  }
  const r = await fetchClasses({ email: scope.email, name: scope.name });
  return { configured: true, scope, classes: r.ok ? r.classes : [], reports, error: r.ok ? "" : r.error };
}

/** Every class, for admins and assessors picking a teacher's class by hand. */
export async function allClassesData() {
  const session = await requireSession();
  if (!canAssessFor(session)) throw new Error("Not allowed.");
  if (!parentsConfigured()) return { configured: false, classes: [] };
  const r = await fetchClasses({ all: true });
  return { configured: true, classes: r.ok ? r.classes : [], error: r.ok ? "" : r.error };
}

function shapeReport(r) {
  let perChild = [];
  try {
    perChild = JSON.parse(r.per_child || "[]");
  } catch {
    perChild = [];
  }
  return {
    id: r.id,
    classId: r.parent_class_id,
    className: r.class_name,
    centre: r.centre || "",
    lessonDate: r.lesson_date,
    portion: r.portion || "",
    went: r.went,
    practise: r.practise || "",
    perChild: Array.isArray(perChild) ? perChild : [],
    sentAt: r.sent_at,
    sendError: r.send_error || "",
    createdAt: r.created_at,
  };
}

// A teacher may act on a class only if the parents portal lists it as theirs.
async function ownsClass(scope, classId) {
  const r = await fetchClasses({ email: scope.email, name: scope.name });
  if (!r.ok) return { error: r.error };
  const cls = r.classes.find((c) => c.id === classId);
  return cls ? { cls } : { error: "That class is not one of yours." };
}

/**
 * Write the after-lesson report. Stored here first, then sent; if the parents
 * portal is down the row keeps the error and the teacher can resend, so a
 * report is never lost to a bad connection at the centre.
 */
export async function writeClassReport(input) {
  const session = await requireSession();
  const scope = await scopeFor(session, null);
  if (!parentsConfigured()) return { error: "The parents portal link is not set up. Ask an admin." };

  const classId = clean(input?.classId, 64);
  const lessonDate = isDateString(input?.lessonDate) ? input.lessonDate : sgToday();
  const portion = clean(input?.portion, 120);
  const went = clean(input?.went, 1500);
  const practise = clean(input?.practise, 500);
  const perChild = (Array.isArray(input?.perChild) ? input.perChild : [])
    .map((p) => ({ childId: clean(p?.childId, 64), name: clean(p?.name, 80), line: clean(p?.line, 300) }))
    .filter((p) => p.childId && p.line);
  if (!classId) return { error: "Choose the class." };
  if (!went) return { error: "Say how the class went — that is the report." };
  if (lessonDate > sgToday()) return { error: "The lesson date cannot be in the future." };

  const owned = await ownsClass(scope, classId);
  if (owned.error) return { error: owned.error };
  const { cls } = owned;

  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO class_reports (id, teacher_id, parent_class_id, class_name, centre, lesson_date, portion, went, practise, per_child, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, scope.teacherId, cls.id, cls.name, cls.centre, lessonDate, portion || null, went, practise || null, JSON.stringify(perChild), now);

  const sent = await deliver(db, id, { classId: cls.id, teacherName: scope.name, lessonDate, portion, went, practise, perChild });
  revalidatePath("/classes");
  return sent.ok ? { ok: true, id, sent: sent.sent } : { ok: true, id, sent: 0, warning: sent.error };
}

async function deliver(db, id, payload) {
  const r = await sendClassReport(payload);
  if (r.ok) {
    db.prepare("UPDATE class_reports SET sent_at = ?, send_error = NULL WHERE id = ?").run(new Date().toISOString(), id);
    return { ok: true, sent: r.sent ?? 0 };
  }
  db.prepare("UPDATE class_reports SET send_error = ? WHERE id = ?").run(String(r.error || "failed").slice(0, 300), id);
  return { ok: false, error: r.error };
}

/** Try again for a report the parents portal never accepted. */
export async function resendClassReport(id) {
  const session = await requireSession();
  const db = getDb();
  const r = db.prepare("SELECT * FROM class_reports WHERE id = ? AND teacher_id = ?").get(clean(id, 64), session.userId);
  if (!r) return { error: "Report not found." };
  if (r.sent_at) return { ok: true, sent: 0 };
  const shaped = shapeReport(r);
  const sent = await deliver(db, r.id, {
    classId: shaped.classId,
    teacherName: session.fullName,
    lessonDate: shaped.lessonDate,
    portion: shaped.portion,
    went: shaped.went,
    practise: shaped.practise,
    perChild: shaped.perChild,
  });
  revalidatePath("/classes");
  return sent.ok ? { ok: true, sent: sent.sent } : { error: sent.error };
}

export async function deleteClassReport(id) {
  const session = await requireSession();
  const db = getDb();
  const r = db.prepare("SELECT id, sent_at FROM class_reports WHERE id = ? AND teacher_id = ?").get(clean(id, 64), session.userId);
  if (!r) return { error: "Report not found." };
  if (r.sent_at) return { error: "This report has already reached parents; it can't be withdrawn from here." };
  db.prepare("DELETE FROM class_reports WHERE id = ?").run(r.id);
  revalidatePath("/classes");
  return { ok: true };
}

/** Skill 1: the two fields a teacher keeps on a child in their class. */
export async function saveChildDetails(input) {
  const session = await requireSession();
  const scope = await scopeFor(session, null);
  if (!parentsConfigured()) return { error: "The parents portal link is not set up. Ask an admin." };
  const classId = clean(input?.classId, 64);
  const childId = clean(input?.childId, 64);
  if (!classId || !childId) return { error: "Missing child." };
  const owned = await ownsClass(scope, classId);
  if (owned.error) return { error: owned.error };
  if (!owned.cls.children.some((c) => c.id === childId)) return { error: "That child is not in your class." };

  const r = await updateChild(childId, {
    classId,
    level: clean(input?.level, 120),
    teacherNotes: clean(input?.teacherNotes, 2000),
  });
  if (!r.ok) return { error: r.error };
  revalidatePath("/classes");
  return { ok: true };
}

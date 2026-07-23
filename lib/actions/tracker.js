"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { getDb, LESSON_GRADES } from "@/lib/db";
import { allowedClassesFor } from "@/lib/tracker/access";
import { sabaqLabel, surahByNumber } from "@/lib/quran/surah-list";

// The roster, history and lessons live in the portal's own database (imported
// once from the Google Sheet). Admins manage students and branch assignments in
// the app; these actions enforce that a caller only touches their branches.

function sgToday() {
  const n = new Date();
  const sg = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  const m = sg.getMonth() + 1;
  const d = sg.getDate();
  return `${sg.getFullYear()}-${m < 10 ? "0" : ""}${m}-${d < 10 ? "0" : ""}${d}`;
}

async function requireClass(cls) {
  const session = await requireSession();
  if (!allowedClassesFor(session).includes(cls)) {
    throw new Error("You don't have access to this class.");
  }
  return session;
}

export async function getRoster(cls) {
  await requireClass(cls);
  const db = getDb();
  const today = sgToday();
  const students = db
    .prepare("SELECT id, name, class, juz, position, photo FROM students WHERE class = ? ORDER BY name")
    .all(cls);
  const lastStmt = db.prepare(
    "SELECT surah, from_ayah, to_ayah, grade, date FROM lessons WHERE student_id = ? ORDER BY date DESC, created_at DESC LIMIT 1"
  );
  const todayStmt = db.prepare("SELECT COUNT(*) AS c FROM lessons WHERE student_id = ? AND date = ?");

  return students.map((s) => {
    const last = lastStmt.get(s.id);
    return {
      id: s.id,
      name: s.name,
      class: s.class,
      juz: s.juz,
      position: s.position || "",
      photo: s.photo || "",
      lastRead: last && last.surah ? { s: last.surah, f: last.from_ayah, t: last.to_ayah } : null,
      lastGrade: last ? last.grade || "" : "",
      lastDate: last ? last.date : "",
      logged: todayStmt.get(s.id, today).c > 0,
    };
  });
}

export async function getHistory(studentId) {
  const session = await requireSession();
  const db = getDb();
  const student = db.prepare("SELECT class FROM students WHERE id = ?").get(Number(studentId));
  if (!student) throw new Error("Student not found.");
  if (!allowedClassesFor(session).includes(student.class)) throw new Error("You don't have access to this student.");

  return db
    .prepare(
      `SELECT date, sabaq, grade, slips, note, surah, from_ayah AS "from", to_ayah AS "to"
       FROM lessons WHERE student_id = ? ORDER BY date DESC, created_at DESC`
    )
    .all(Number(studentId));
}

export async function saveLesson(input) {
  const session = await requireSession();
  const db = getDb();
  const student = db.prepare("SELECT id, class FROM students WHERE id = ?").get(Number(input.studentId));
  if (!student) throw new Error("Student not found.");
  if (!allowedClassesFor(session).includes(student.class)) throw new Error("You don't have access to this student.");

  const surah = Number(input.surah);
  const from = Number(input.from);
  const to = Number(input.to);
  const s = surahByNumber(surah);
  if (!s || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > s.ayahCount || to < from || to > s.ayahCount) {
    throw new Error("Invalid portion.");
  }
  const grade = LESSON_GRADES.includes(input.grade) ? input.grade : "";
  const note = String(input.note || "").trim().slice(0, 1000) || null;
  const label = sabaqLabel(surah, from, to);
  const date = sgToday();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO lessons (id, student_id, class, date, surah, from_ayah, to_ayah, sabaq, grade, slips, note, teacher_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(randomUUID(), student.id, student.class, date, surah, from, to, label, grade, note, session.userId, now);

  revalidatePath("/hafalan");
  revalidatePath("/dashboard");
  return { ok: true, sabaq: label, grade, date };
}

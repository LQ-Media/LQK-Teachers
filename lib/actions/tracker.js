"use server";

import { requireSession } from "@/lib/dal";
import { LESSON_GRADES } from "@/lib/tracker/grades";
import { allowedClassesFor } from "@/lib/tracker/access";
import { sabaqLabel, surahByNumber } from "@/lib/quran/surah-list";
import { sheetRoster, sheetHistory, sheetSaveLesson } from "@/lib/tracker/sheet";

// The roster, history and lessons all live in the LQK Google Sheet (the same
// backend the Shopify tracker uses), so admins manage students by editing the
// Sheet and the portal reflects it live. These actions just proxy the Sheet
// server-side, enforcing that the caller may only touch their own branches.

async function requireClass(cls) {
  const session = await requireSession();
  if (!allowedClassesFor(session).includes(cls)) {
    throw new Error("You don't have access to this class.");
  }
  return session;
}

async function assertStudentInClass(sid, cls) {
  const roster = await sheetRoster(cls);
  if (!roster.some((s) => Number(s.id) === Number(sid))) {
    throw new Error("You don't have access to this student.");
  }
}

export async function getRoster(cls) {
  await requireClass(cls);
  const students = await sheetRoster(cls);
  return students.map((s) => ({
    id: s.id,
    name: s.name || "",
    class: cls,
    juz: s.juz || 1,
    position: s.pos || "",
    photo: s.photo || "",
    lastRead: s.lastRead && s.lastRead.s ? { s: s.lastRead.s, f: s.lastRead.f, t: s.lastRead.t } : null,
    lastGrade: s.lastGrade || "",
    lastDate: s.lastDate || "",
    logged: !!s.logged,
  }));
}

export async function getHistory(studentId, cls) {
  await requireClass(cls);
  await assertStudentInClass(studentId, cls);
  const lessons = await sheetHistory(studentId);
  return lessons.map((l) => ({
    date: l.date,
    sabaq: l.sabaq,
    grade: l.grade || "",
    slips: l.slips || 0,
    note: l.note || "",
    surah: l.surah,
    from: l.from,
    to: l.to,
  }));
}

export async function saveLesson(input) {
  const cls = String(input.cls || "");
  await requireClass(cls);
  await assertStudentInClass(input.studentId, cls);

  const surah = Number(input.surah);
  const from = Number(input.from);
  const to = Number(input.to);
  const s = surahByNumber(surah);
  if (!s || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > s.ayahCount || to < from || to > s.ayahCount) {
    throw new Error("Invalid portion.");
  }
  const grade = LESSON_GRADES.includes(input.grade) ? input.grade : "";
  const note = String(input.note || "").trim().slice(0, 1000);
  const label = sabaqLabel(surah, from, to);

  await sheetSaveLesson({ sid: Number(input.studentId), cls, surah, from, to, sabaq: label, grade, note });
  return { ok: true, sabaq: label, grade };
}

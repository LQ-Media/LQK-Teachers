/**
 * One-time (re-runnable) migration: pull students and lesson history from the
 * existing Shopify tracker's Google Apps Script backend into the portal DB.
 *
 * Run it in the same environment as the app (same LQK_DATA_DIR), e.g. the
 * Railway console:
 *   node scripts/import-from-sheet.mjs
 *
 * Student data is fetched at run time from the Sheet — it is never committed to
 * the repository. Safe to re-run: it replaces the students/lessons tables each
 * time, so the portal mirrors the current Sheet.
 */

if (!process.env.NODE_ENV) process.env.NODE_ENV = "production"; // never trigger demo seeding

import { randomUUID } from "node:crypto";
import { getDb } from "../lib/db.js";

const SCRIPT_URL =
  process.env.LQK_SHEET_URL ||
  "https://script.google.com/macros/s/AKfycbxL2vyQWZbfEOrZWA-Z1vhhiDB0cCCmgaqUEIorDJ_lrbAZVTwRyyjJ1r5906r6rYMvwA/exec";
const TOKEN = process.env.LQK_SHEET_TOKEN || "LQK-Teacher-App";
const CLASSES = ["WOODS SQUARE", "PRIMZ BIZHUB", "TAMPINES BLK 462", "TAMPINES JUNCTION", "MANAGEMENT TEAM"];

function sgToday() {
  const n = new Date();
  const sg = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  const m = sg.getMonth() + 1;
  const d = sg.getDate();
  return `${sg.getFullYear()}-${m < 10 ? "0" : ""}${m}-${d < 10 ? "0" : ""}${d}`;
}

async function getJson(params) {
  const url = `${SCRIPT_URL}?token=${encodeURIComponent(TOKEN)}&${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "not ok");
  return j;
}

async function run() {
  const db = getDb();

  // Gather every class roster first, so a mid-run failure doesn't half-wipe data.
  const students = [];
  for (const cls of CLASSES) {
    const j = await getJson(`action=roster&cls=${encodeURIComponent(cls)}&date=${sgToday()}`);
    for (const s of j.students || []) {
      students.push({ id: s.id, name: s.name, class: cls, juz: s.juz || 1, position: s.pos || "", photo: s.photo || "" });
    }
    console.log(`roster ${cls}: ${(j.students || []).length}`);
  }

  // Fetch each student's history.
  const lessons = [];
  for (const s of students) {
    let hist = [];
    try {
      const j = await getJson(`action=history&sid=${encodeURIComponent(s.id)}`);
      hist = j.lessons || [];
    } catch (e) {
      console.warn(`history sid=${s.id} failed: ${e.message}`);
    }
    for (const l of hist) {
      lessons.push({
        student_id: s.id,
        class: s.class,
        date: String(l.date || "").slice(0, 10),
        surah: l.surah || null,
        from_ayah: l.from || null,
        to_ayah: l.to || null,
        sabaq: l.sabaq || "",
        grade: l.grade || "",
        slips: l.slips || 0,
        note: l.note || null,
        created_at: l.savedAt || new Date().toISOString(),
      });
    }
  }

  console.log(`Importing ${students.length} students and ${lessons.length} lessons…`);

  const insertStudent = db.prepare(
    "INSERT INTO students (id, name, class, juz, position, photo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertLesson = db.prepare(
    `INSERT INTO lessons (id, student_id, class, date, surah, from_ayah, to_ayah, sabaq, grade, slips, note, teacher_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  );

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM lessons; DELETE FROM students;");
    const now = new Date().toISOString();
    for (const s of students) insertStudent.run(s.id, s.name, s.class, s.juz, s.position, s.photo, now);
    for (const l of lessons)
      insertLesson.run(randomUUID(), l.student_id, l.class, l.date, l.surah, l.from_ayah, l.to_ayah, l.sabaq, l.grade, l.slips, l.note, l.created_at);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  console.log(`Done. Students: ${students.length}, Lessons: ${lessons.length}.`);
}

run().catch((e) => {
  console.error("Import failed:", e.message);
  process.exit(1);
});

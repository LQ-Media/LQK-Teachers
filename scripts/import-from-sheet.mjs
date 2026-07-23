/**
 * One-time (re-runnable) migration from the LQK Google Sheet into the portal DB.
 * The portal is the system of record after this — the Sheet becomes a starting
 * point only.
 *
 *   node scripts/import-from-sheet.mjs
 *
 * Imports:
 *  - Teachers tab  -> profiles (login accounts). Temp password is HASHED with a
 *    "must change on first login" flag. Existing accounts keep their password
 *    (only name/role/branch/position/photo are refreshed) so a re-run never
 *    resets a password someone already changed.
 *  - Students tab  -> students (roster), replaced wholesale.
 *  - Lesson history (Apps Script) -> lessons, replaced wholesale.
 *
 * No student/teacher data is committed to the repo — it's read at run time.
 */

if (!process.env.NODE_ENV) process.env.NODE_ENV = "production"; // never demo-seed

import { randomUUID } from "node:crypto";
import { getDb, TRACKER_CLASSES } from "../lib/db.js";
import { hashPassword } from "../lib/hash.js";

const SHEET_ID = process.env.LQK_SHEET_ID || "1Kfkyy4V-lMOwji2PYtSj7prsZC9kRHfce0Xk4E6DYsk";
const SCRIPT_URL =
  process.env.LQK_SHEET_URL ||
  "https://script.google.com/macros/s/AKfycbxL2vyQWZbfEOrZWA-Z1vhhiDB0cCCmgaqUEIorDJ_lrbAZVTwRyyjJ1r5906r6rYMvwA/exec";
const TOKEN = process.env.LQK_SHEET_TOKEN || "LQK-Teacher-App";
const TEMP_PASSWORD = process.env.LQK_TEMP_PASSWORD || "LQK2488!";

function sgToday() {
  const n = new Date();
  const sg = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  const m = sg.getMonth() + 1;
  const d = sg.getDate();
  return `${sg.getFullYear()}-${m < 10 ? "0" : ""}${m}-${d < 10 ? "0" : ""}${d}`;
}

/** Minimal CSV parser (handles quoted fields + commas + escaped quotes). */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchTeachers() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Teachers`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Teachers fetch failed (${res.status})`);
  const rows = parseCSV(await res.text()).filter((r) => r.some((c) => c && c.trim()));
  rows.shift(); // header
  return rows
    .map((r) => ({
      name: (r[0] || "").trim(),
      role: /admin/i.test(r[1] || "") ? "admin" : "teacher",
      branch: (r[2] || "").trim(),
      position: (r[3] || "").trim(),
      email: (r[4] || "").trim().toLowerCase(),
      password: (r[5] || "").trim() || TEMP_PASSWORD,
      photo: (r[6] || "").trim(),
    }))
    .filter((t) => t.email && t.name);
}

async function apiGet(params) {
  const res = await fetch(`${SCRIPT_URL}?token=${encodeURIComponent(TOKEN)}&${params}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "api error");
  return j;
}

async function run() {
  const db = getDb();
  const now = new Date().toISOString();

  // --- Accounts (upsert by email) ---
  const teachers = await fetchTeachers();
  console.log(`Teachers in sheet: ${teachers.length}`);
  const findByEmail = db.prepare("SELECT id FROM profiles WHERE email = ?");
  const insertProfile = db.prepare(
    `INSERT INTO profiles (id, full_name, email, password_hash, role, primary_location, position, photo, must_change_password, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );
  const updateProfile = db.prepare(
    "UPDATE profiles SET full_name = ?, role = ?, primary_location = ?, position = ?, photo = ? WHERE id = ?"
  );
  const addLocation = db.prepare(
    "INSERT OR IGNORE INTO teacher_locations (id, teacher_id, location, is_primary) VALUES (?, ?, ?, 1)"
  );
  let created = 0;
  let updated = 0;
  for (const t of teachers) {
    const existing = findByEmail.get(t.email);
    let id;
    if (existing) {
      id = existing.id;
      updateProfile.run(t.name, t.role, t.branch, t.position, t.photo, id);
      updated++;
    } else {
      id = randomUUID();
      insertProfile.run(id, t.name, t.email, hashPassword(t.password), t.role, t.branch, t.position, t.photo, now);
      created++;
    }
    if (t.branch) addLocation.run(randomUUID(), id, t.branch);
  }
  console.log(`Accounts — created: ${created}, updated: ${updated}`);

  // --- Roster + lessons (replaced wholesale) ---
  const students = [];
  for (const cls of TRACKER_CLASSES) {
    const j = await apiGet(`action=roster&cls=${encodeURIComponent(cls)}&date=${sgToday()}`);
    for (const s of j.students || []) {
      students.push({ id: s.id, name: s.name || "", class: cls, juz: s.juz || 1, position: s.pos || "", photo: s.photo || "" });
    }
    console.log(`roster ${cls}: ${(j.students || []).length}`);
  }
  const lessons = [];
  for (const s of students) {
    try {
      const j = await apiGet(`action=history&sid=${encodeURIComponent(s.id)}`);
      for (const l of j.lessons || []) {
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
          created_at: l.savedAt || now,
        });
      }
    } catch (e) {
      console.warn(`history sid=${s.id} failed: ${e.message}`);
    }
  }
  console.log(`Students: ${students.length}, Lessons: ${lessons.length}`);

  const insStudent = db.prepare(
    "INSERT INTO students (id, name, class, juz, position, photo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insLesson = db.prepare(
    `INSERT INTO lessons (id, student_id, class, date, surah, from_ayah, to_ayah, sabaq, grade, slips, note, teacher_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  );
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM lessons; DELETE FROM students;");
    for (const s of students) insStudent.run(s.id, s.name, s.class, s.juz, s.position, s.photo, now);
    for (const l of lessons)
      insLesson.run(randomUUID(), l.student_id, l.class, l.date, l.surah, l.from_ayah, l.to_ayah, l.sabaq, l.grade, l.slips, l.note, l.created_at);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  console.log(`Done. Accounts ${created + updated}, Students ${students.length}, Lessons ${lessons.length}.`);
}

run().catch((e) => {
  console.error("Import failed:", e.message);
  process.exit(1);
});

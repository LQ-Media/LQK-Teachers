import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "./hash.js";
import { LESSON_GRADES } from "./tracker/grades.js";

export const LOCATIONS = [
  "Woods Square",
  "Primz Bizhub",
  "Tampines Blk 462",
  "Tampines Junction",
];

// Quran-tracker classes (student rosters), mirroring the Shopify tracker.
// Stored on students/lessons verbatim; MANAGEMENT TEAM is not a physical branch.
export const TRACKER_CLASSES = [
  "WOODS SQUARE",
  "PRIMZ BIZHUB",
  "TAMPINES BLK 462",
  "TAMPINES JUNCTION",
  "MANAGEMENT TEAM",
];

export { LESSON_GRADES };

// LQK_DATA_DIR lets a deploy point the SQLite file at a mounted persistent
// volume (e.g. /data on Railway/Fly/Render). Falls back to ./data for local dev.
const DB_DIR = process.env.LQK_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "lqk.db");

let db;

// The persistent data directory (SQLite lives here; uploads go in subfolders).
// On Railway/Fly/Render this is the mounted volume via LQK_DATA_DIR.
export function getDataDir() {
  return DB_DIR;
}

function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teacher', 'reviewer', 'admin')),
      primary_location TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teacher_locations (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      location TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      UNIQUE(teacher_id, location)
    );

    CREATE TABLE IF NOT EXISTS hafalan_entries (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      surah_number INTEGER NOT NULL,
      surah_name TEXT NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('lancar', 'mutqin', 'needs_review')),
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewer_id TEXT REFERENCES profiles(id),
      reviewer_note TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reading_entries (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('surah', 'session')),
      surah_number INTEGER,
      surah_name TEXT,
      session_minutes INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quran_bookmarks (
      teacher_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL,
      verse_key TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Quran-tracker: student rosters and their logged lessons.
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY,        -- keeps the original Sheet id for continuity
      name TEXT NOT NULL,
      class TEXT NOT NULL,
      juz INTEGER NOT NULL DEFAULT 1,
      position TEXT,                 -- e.g. "Hifz · Juz 12" (may be empty)
      photo TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_students_class ON students(class);

    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      class TEXT NOT NULL,
      date TEXT NOT NULL,            -- YYYY-MM-DD (Singapore)
      surah INTEGER,
      from_ayah INTEGER,
      to_ayah INTEGER,
      sabaq TEXT,                    -- label, e.g. "Al-Fatihah 6–7"
      grade TEXT,                    -- Excellent | Pass | Repeat | ''
      slips INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      teacher_id TEXT REFERENCES profiles(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons(student_id);
    CREATE INDEX IF NOT EXISTS idx_lessons_class_date ON lessons(class, date);

    -- Work hours: clock in/out sessions for payroll.
    -- category 'teaching' pays at the teacher's pay_tier rate; 'ot' pays the
    -- flat OT rate. A session with ended_at IS NULL is currently running.
    -- rate_cents snapshots the $/hr applied when an admin approves it, so a
    -- later tier change never rewrites already-approved payroll.
    CREATE TABLE IF NOT EXISTS work_sessions (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('teaching', 'ot')),
      ot_reason TEXT,                -- only for category='ot'
      branch TEXT,                   -- optional; defaults to the teacher's primary
      started_at TEXT NOT NULL,      -- ISO UTC
      ended_at TEXT,                 -- ISO UTC; NULL while clocked in (running)
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      rate_cents INTEGER,            -- $/hr in cents, snapshot at approval
      reviewer_id TEXT REFERENCES profiles(id),
      reviewer_note TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_work_sessions_teacher ON work_sessions(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_work_sessions_status ON work_sessions(status);

    -- Invited emails: the allowlist for self-registration. An admin pre-adds a
    -- teacher's email (with the role/branch/tier they should get); only a
    -- matching, unused invite lets someone create their own account at /register.
    -- The branches column is a JSON array of extra branches (kept inline — an
    -- invite is short-lived and becomes teacher_locations rows on signup).
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'reviewer', 'admin')),
      primary_location TEXT,
      position TEXT,
      pay_tier TEXT,
      branches TEXT,
      invited_by TEXT REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      used_at TEXT
    );
  `);

  // Additive migrations for account fields (safe to run on an existing DB).
  const cols = new Set(database.prepare("PRAGMA table_info(profiles)").all().map((c) => c.name));
  if (!cols.has("position")) database.exec("ALTER TABLE profiles ADD COLUMN position TEXT");
  if (!cols.has("photo")) database.exec("ALTER TABLE profiles ADD COLUMN photo TEXT");
  if (!cols.has("must_change_password"))
    database.exec("ALTER TABLE profiles ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  // Work-hours pay tier (asst_probation | asst | lead | lead_ars); NULL = unset.
  if (!cols.has("pay_tier")) database.exec("ALTER TABLE profiles ADD COLUMN pay_tier TEXT");

  // Additive migrations for "Last read" reading entries: an optional ayah
  // (verse_key, e.g. "2:255") and a user-editable moment of reading (read_at).
  // We reuse entry_type='surah' for "Last read" so the CHECK constraint is
  // untouched; read_at falls back to created_at when absent.
  const rcols = new Set(database.prepare("PRAGMA table_info(reading_entries)").all().map((c) => c.name));
  if (!rcols.has("verse_key")) database.exec("ALTER TABLE reading_entries ADD COLUMN verse_key TEXT");
  if (!rcols.has("read_at")) database.exec("ALTER TABLE reading_entries ADD COLUMN read_at TEXT");
}

function seedIfEmpty(database) {
  // Never seed demo accounts in production — a public deploy must start with an
  // empty profiles table. Create the first real admin with scripts/create-admin.mjs.
  if (process.env.NODE_ENV === "production") return;

  const { count } = database.prepare("SELECT COUNT(*) AS count FROM profiles").get();
  if (count > 0) return;

  const now = new Date().toISOString();
  const insertProfile = database.prepare(`
    INSERT INTO profiles (id, full_name, email, password_hash, role, primary_location, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLocation = database.prepare(`
    INSERT INTO teacher_locations (id, teacher_id, location, is_primary) VALUES (?, ?, ?, ?)
  `);
  const insertHafalan = database.prepare(`
    INSERT INTO hafalan_entries (id, teacher_id, surah_number, surah_name, rating, note, status, reviewer_id, reviewer_note, reviewed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertReading = database.prepare(`
    INSERT INTO reading_entries (id, teacher_id, entry_type, surah_number, surah_name, session_minutes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const admin = { id: randomUUID(), email: "admin@lqk.test", name: "Nur Abdul Karim" };
  const reviewer = { id: randomUUID(), email: "reviewer@lqk.test", name: "Ustaz Hafiz Rahman" };
  const teacher1 = { id: randomUUID(), email: "teacher@lqk.test", name: "Siti Aminah" };
  const teacher2 = { id: randomUUID(), email: "teacher2@lqk.test", name: "Muhammad Faiz" };

  insertProfile.run(admin.id, admin.name, admin.email, hashPassword("password123"), "admin", null, now);
  insertProfile.run(reviewer.id, reviewer.name, reviewer.email, hashPassword("password123"), "reviewer", "Woods Square", now);
  insertProfile.run(teacher1.id, teacher1.name, teacher1.email, hashPassword("password123"), "teacher", "Woods Square", now);
  insertProfile.run(teacher2.id, teacher2.name, teacher2.email, hashPassword("password123"), "teacher", "Tampines Junction", now);

  insertLocation.run(randomUUID(), reviewer.id, "Woods Square", 1);
  insertLocation.run(randomUUID(), teacher1.id, "Woods Square", 1);
  insertLocation.run(randomUUID(), teacher2.id, "Tampines Junction", 1);
  insertLocation.run(randomUUID(), teacher2.id, "Primz Bizhub", 0);

  insertHafalan.run(randomUUID(), teacher1.id, 112, "Al-Ikhlas", "mutqin", "Confident on tajweed now.", "approved", reviewer.id, "Great steady recitation.", now, now, now);
  insertHafalan.run(randomUUID(), teacher1.id, 113, "Al-Falaq", "lancar", "Still mixing up ayah 4 and 5 word order.", "pending", null, null, null, now, now);
  insertHafalan.run(randomUUID(), teacher2.id, 94, "Ash-Sharh", "needs_review", "Losing pace midway through.", "pending", null, null, null, now, now);
  insertHafalan.run(randomUUID(), teacher2.id, 108, "Al-Kawthar", "lancar", null, "rejected", reviewer.id, "Please re-record with clearer pronunciation of the final ayah.", now, now, now);

  insertReading.run(randomUUID(), teacher1.id, "surah", 114, "An-Nas", null, now);
  insertReading.run(randomUUID(), teacher1.id, "session", null, null, 20, now);
  insertReading.run(randomUUID(), teacher2.id, "surah", 109, "Al-Kafirun", null, now);

  // Demo students for the Quran tracker (dev only). Real rosters are imported
  // from the existing Google Sheet at deploy time (scripts/import-from-sheet.mjs).
  const insertStudent = database.prepare(`
    INSERT INTO students (id, name, class, juz, position, photo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLesson = database.prepare(`
    INSERT INTO lessons (id, student_id, class, date, surah, from_ayah, to_ayah, sabaq, grade, slips, note, teacher_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertStudent.run(9001, "AISYAH DEMO BINTE ALI", "WOODS SQUARE", 1, "", "", now);
  insertStudent.run(9002, "YUSUF DEMO BIN OMAR", "WOODS SQUARE", 2, "", "", now);
  insertStudent.run(9003, "MARYAM DEMO D/O RAHIM", "TAMPINES JUNCTION", 1, "", "", now);
  insertLesson.run(
    randomUUID(), 9001, "WOODS SQUARE", "2026-07-20", 1, 1, 2, "Al-Fatihah 1–2", "Excellent", 0,
    "Good tajweed.", teacher1.id, now
  );
  insertLesson.run(
    randomUUID(), 9001, "WOODS SQUARE", "2026-07-21", 1, 3, 5, "Al-Fatihah 3–5", "Pass", 0, "", teacher1.id, now
  );

  // Demo work-hours (dev only). Pay tiers + a mix of approved/pending sessions.
  database.prepare("UPDATE profiles SET pay_tier = ? WHERE id = ?").run("lead", teacher1.id);
  database.prepare("UPDATE profiles SET pay_tier = ? WHERE id = ?").run("asst", teacher2.id);
  const dayMs = 86400000;
  const at = (daysAgo, hh, mm = 0) => {
    const d = new Date(Date.now() - daysAgo * dayMs);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  };
  const insertWork = database.prepare(`
    INSERT INTO work_sessions (id, teacher_id, category, ot_reason, branch, started_at, ended_at, note, status, rate_cents, reviewer_id, reviewer_note, reviewed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // teacher1 (Lead, $20/hr): one approved teaching block, one pending teaching, one pending OT.
  insertWork.run(randomUUID(), teacher1.id, "teaching", null, "Woods Square", at(2, 9), at(2, 11, 30), "", "approved", 2000, reviewer.id, null, now, now, now);
  insertWork.run(randomUUID(), teacher1.id, "teaching", null, "Woods Square", at(1, 9), at(1, 11), "", "pending", null, null, null, null, now, now);
  insertWork.run(randomUUID(), teacher1.id, "ot", "Centre cleaning", "Woods Square", at(1, 14), at(1, 15, 30), "Deep clean before event", "pending", null, null, null, null, now, now);
  // teacher2 (Asst, $15/hr): one approved teaching block.
  insertWork.run(randomUUID(), teacher2.id, "teaching", null, "Tampines Junction", at(3, 16), at(3, 18), "", "approved", 1500, reviewer.id, null, now, now, now);
}

export function getDb() {
  if (db) return db;
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(db);
  seedIfEmpty(db);
  return db;
}

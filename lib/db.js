import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "./hash.js";

export const LOCATIONS = [
  "Woods Square",
  "Primz Bizhub",
  "Tampines Blk 462",
  "Tampines Junction",
];

// LQK_DATA_DIR lets a deploy point the SQLite file at a mounted persistent
// volume (e.g. /data on Railway/Fly/Render). Falls back to ./data for local dev.
const DB_DIR = process.env.LQK_DATA_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "lqk.db");

let db;

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
  `);
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

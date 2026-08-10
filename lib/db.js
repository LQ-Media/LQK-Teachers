import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "./hash.js";
import { LESSON_GRADES } from "./tracker/grades.js";

export { LOCATIONS } from "./locations.js";

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

    -- Shifts: the PLAN. Admins roster teaching shifts ahead of time; a teacher
    -- only ever taps "clock in". OT is inserted here by an admin after MH has
    -- approved it verbally, and needs no clock-in at all.
    --
    -- The split from work_sessions is deliberate: shifts is what was meant to
    -- happen, work_sessions is what gets paid. A session copies the shift's
    -- times when it is created, so editing a shift afterwards can never rewrite
    -- somebody's pay — the same discipline as the rate_cents snapshot.
    --
    -- Shifts are CANCELLED, never deleted: a cancelled shift still answers
    -- "was this ever rostered?", and work_sessions.shift_id is a real FK, so
    -- deleting a worked shift would throw rather than explain itself.
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('teaching', 'ot')),
      ot_reason TEXT,                -- only for category='ot'
      branch TEXT,
      date TEXT NOT NULL,            -- YYYY-MM-DD, Singapore
      start_time TEXT NOT NULL,      -- HH:MM, Singapore
      end_time TEXT NOT NULL,        -- HH:MM; may be <= start_time, meaning next day
      starts_at TEXT NOT NULL,       -- ISO UTC, derived from date+start_time
      ends_at TEXT NOT NULL,         -- ISO UTC, derived (rolled to +1 day if spanning)
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'cancelled')),
      cancel_reason TEXT,            -- holiday | cancelled | leave | error
      cancelled_by TEXT REFERENCES profiles(id),
      cancelled_at TEXT,
      ph_name TEXT,                  -- public holiday falling on that date, else NULL
      unpaid INTEGER NOT NULL DEFAULT 0, -- salaried staff: rostered but never payable
      missed_reason TEXT,            -- the teacher's own explanation for not clocking in
      missed_reason_at TEXT,
      resolution TEXT CHECK (resolution IS NULL OR resolution IN ('accepted', 'rejected')),
      resolved_by TEXT REFERENCES profiles(id),
      resolved_at TEXT,
      batch_id TEXT,                 -- one bulk generation — the undo handle
      note TEXT,
      created_by TEXT REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shifts_teacher_date ON shifts(teacher_id, date);
    CREATE INDEX IF NOT EXISTS idx_shifts_date_status ON shifts(date, status);
    CREATE INDEX IF NOT EXISTS idx_shifts_batch ON shifts(batch_id);
    -- An admin will re-submit the bulk generator. This makes that a no-op
    -- rather than a duplicate roster.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_unique_planned
      ON shifts(teacher_id, starts_at) WHERE status = 'planned';

    -- Singapore public holidays, imported from MOM's official dataset on
    -- data.gov.sg by scripts/sync-public-holidays.mjs. Kept in the DB (rather
    -- than fetched live) so payroll never depends on a third party being up.
    CREATE TABLE IF NOT EXISTS public_holidays (
      date TEXT PRIMARY KEY,         -- YYYY-MM-DD, Singapore
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

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

    -- Halaqah Notebook: a teacher's own notes from a kuliah/syarahan/class.
    -- raw_text is always the source of truth (transcript, photo text, or what
    -- they typed) and is kept alongside the AI summary so a teacher can always
    -- check a citation against what was actually said. summary is the JSON
    -- blob shaped by lib/ai/provider.js#normaliseSummary; NULL until summarised.
    -- Audio and photos are never stored — they are transcribed and discarded.
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('recording', 'photo', 'typed')),
      speaker TEXT,                  -- who gave the talk (attribution)
      venue TEXT,                    -- masjid / centre / online
      occurred_on TEXT,              -- YYYY-MM-DD (Singapore)
      language TEXT,                 -- transcription hint used: auto|ms|en|ar
      raw_text TEXT,
      summary TEXT,                  -- JSON, or NULL if not summarised
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_teacher ON notes(teacher_id, created_at DESC);

    -- Lesson Packs: one reusable 30-minute plan per (portion × age group).
    -- Generated once and cached here, so teaching the same ayat next term costs
    -- nothing and every teacher gets the identical plan — that consistency is
    -- the point of the feature. The tajweed column is computed from the mushaf
    -- markup, not from the model. A pack is visible to teachers once approved.
    CREATE TABLE IF NOT EXISTS lesson_packs (
      id TEXT PRIMARY KEY,
      surah INTEGER NOT NULL,
      from_ayah INTEGER NOT NULL,
      to_ayah INTEGER NOT NULL,
      age_group TEXT NOT NULL DEFAULT 'all',
      label TEXT NOT NULL,           -- e.g. "Al-Fatihah 1–7"
      tajweed TEXT,                  -- JSON [{key,label}], computed, no AI
      ayat TEXT,                     -- JSON [{key,arabic,translation}]
      content TEXT,                  -- JSON pack body from the model
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
      created_by TEXT REFERENCES profiles(id),
      approved_by TEXT REFERENCES profiles(id),
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(surah, from_ayah, to_ayah, age_group)
    );
    CREATE INDEX IF NOT EXISTS idx_packs_status ON lesson_packs(status, surah, from_ayah);

    -- Kalimah: one row per teacher per day they completed the word study.
    -- The whole centre studies the same ayah each day (see lib/kalimah/verses.js),
    -- so this only records that a teacher did it and how they scored — the
    -- content itself is never duplicated here.
    CREATE TABLE IF NOT EXISTS kalimah_progress (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      date TEXT NOT NULL,            -- YYYY-MM-DD (Singapore)
      verse_key TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      words_seen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(teacher_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_kalimah_teacher ON kalimah_progress(teacher_id, date DESC);

    -- Achievements: one row per teacher per day they actually read in the Quran
    -- reader. The reader posts a heartbeat only while its tab is visible, so a
    -- reader left open overnight accrues nothing. A day counts toward the streak
    -- at >= STREAK_MIN_SECONDS (see lib/achievements/points.js).
    CREATE TABLE IF NOT EXISTS reader_activity (
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      date TEXT NOT NULL,            -- YYYY-MM-DD (Singapore)
      seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (teacher_id, date)
    );

    -- Admin-maintained list of recognised certificates, so uploads stay
    -- comparable instead of drifting into free text ("ARS", "A.R.S", "ars cert").
    CREATE TABLE IF NOT EXISTS cert_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    -- A teacher uploads proof; an admin approves or rejects it. Same
    -- pending/approved/rejected shape as work_sessions.
    CREATE TABLE IF NOT EXISTS certifications (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      cert_type_id TEXT REFERENCES cert_types(id),
      cert_name TEXT NOT NULL,       -- snapshot of the type name at upload time
      issuer TEXT,
      issued_on TEXT,                -- YYYY-MM-DD, optional
      image_path TEXT NOT NULL,      -- filename under uploads/certs on the volume
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewer_id TEXT REFERENCES profiles(id),
      reviewer_note TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_certifications_teacher ON certifications(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_certifications_status ON certifications(status);

    -- Hand-awarded recognition. kind='monthly' is the featured title for a month
    -- (one holder per month); kind='oneoff' is free-form, awarded any time.
    CREATE TABLE IF NOT EXISTS honours (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('monthly', 'oneoff')),
      title TEXT NOT NULL,
      reason TEXT,
      month TEXT,                    -- YYYY-MM, set for kind='monthly'
      awarded_by TEXT REFERENCES profiles(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_honours_teacher ON honours(teacher_id);

    -- Peer nominations: any teacher nominates a colleague with a reason; an admin
    -- confirms or declines. One nomination per nominator per month.
    CREATE TABLE IF NOT EXISTS nominations (
      id TEXT PRIMARY KEY,
      nominee_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      nominator_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      month TEXT NOT NULL,           -- YYYY-MM
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined')),
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(nominator_id, month)
    );
    CREATE INDEX IF NOT EXISTS idx_nominations_nominee ON nominations(nominee_id);

    -- students.juz records only where someone is NOW, with no history, so a juz
    -- completion has no date and could never be credited to a month. Each future
    -- increase of a staff member's juz is stamped here by updateStudent, which
    -- lets the monthly season award it. All-time totals still come from the juz
    -- column itself, so pre-existing progress is never lost.
    CREATE TABLE IF NOT EXISTS juz_milestones (
      id TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      juz INTEGER NOT NULL,          -- the juz that was completed
      date TEXT NOT NULL,            -- YYYY-MM-DD (Singapore)
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_juz_milestones_student ON juz_milestones(student_id);
  `);

  // Additive migrations for account fields (safe to run on an existing DB).
  const cols = new Set(database.prepare("PRAGMA table_info(profiles)").all().map((c) => c.name));
  if (!cols.has("position")) database.exec("ALTER TABLE profiles ADD COLUMN position TEXT");
  if (!cols.has("photo")) database.exec("ALTER TABLE profiles ADD COLUMN photo TEXT");
  if (!cols.has("must_change_password"))
    database.exec("ALTER TABLE profiles ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  // Work-hours pay tier (asst_probation | asst | lead | lead_ars); NULL = unset.
  if (!cols.has("pay_tier")) database.exec("ALTER TABLE profiles ADD COLUMN pay_tier TEXT");

  // Optional location stamp on a work session — one point, captured from the
  // teacher's device when they tap "Tag my location" (mainly for Ad-hoc / OT,
  // which happens away from a fixed branch). NULL = untagged, which is always a
  // valid session. geo_label is the reverse-geocoded place name resolved once at
  // capture time, so payroll views never call a geocoder; the coordinates remain
  // the record if the label couldn't be resolved. See lib/hours/geo.js.
  const wcols = new Set(database.prepare("PRAGMA table_info(work_sessions)").all().map((c) => c.name));
  if (!wcols.has("geo_lat")) {
    database.exec("ALTER TABLE work_sessions ADD COLUMN geo_lat REAL");
    database.exec("ALTER TABLE work_sessions ADD COLUMN geo_lng REAL");
    database.exec("ALTER TABLE work_sessions ADD COLUMN geo_accuracy REAL"); // metres, as reported
    database.exec("ALTER TABLE work_sessions ADD COLUMN geo_label TEXT");
    database.exec("ALTER TABLE work_sessions ADD COLUMN geo_at TEXT"); // ISO UTC of the capture
  }

  // Rostered shifts (see the `shifts` table). A session created from a shift
  // copies that shift's window into started_at/ended_at — pay is the ROSTERED
  // shift, and clock_in_at is only the attendance record. Deliberately its own
  // guard rather than an extra ALTER inside the geo block above: an existing DB
  // already has geo_lat and would skip anything added there.
  //
  // NOTE the CHECK constraints on status/category cannot be altered by SQLite,
  // so every new lifecycle state lives in these columns or on `shifts`, never
  // as a new status value.
  if (!wcols.has("shift_id")) {
    database.exec("ALTER TABLE work_sessions ADD COLUMN shift_id TEXT REFERENCES shifts(id)");
    database.exec("ALTER TABLE work_sessions ADD COLUMN clock_in_at TEXT");  // when they actually tapped
    database.exec("ALTER TABLE work_sessions ADD COLUMN clock_out_at TEXT"); // optional departure stamp; never changes pay
    database.exec("ALTER TABLE work_sessions ADD COLUMN source TEXT");       // clock_in | unscheduled | admin_ot | missed_accepted
    database.exec("ALTER TABLE work_sessions ADD COLUMN created_by TEXT REFERENCES profiles(id)");
    database.exec("ALTER TABLE work_sessions ADD COLUMN ph_name TEXT");      // public holiday, copied from the shift
    database.exec("ALTER TABLE work_sessions ADD COLUMN ph_multiplier REAL"); // snapshot at approval, like rate_cents
  }
  // The clock-in guard in lib/actions/hours.js used to rely on "no row with
  // ended_at IS NULL means not clocked in". A rostered session sets ended_at up
  // front, so that guard can no longer catch a double tap — this index is what
  // actually stops one shift being paid twice, across all three creation paths.
  // Safe to create unconditionally: shift_id is NULL on every pre-existing row
  // and a partial index ignores NULLs.
  database.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_work_sessions_shift ON work_sessions(shift_id) WHERE shift_id IS NOT NULL"
  );

  // Additive migrations for "Last read" reading entries: an optional ayah
  // (verse_key, e.g. "2:255") and a user-editable moment of reading (read_at).
  // We reuse entry_type='surah' for "Last read" so the CHECK constraint is
  // untouched; read_at falls back to created_at when absent.
  const rcols = new Set(database.prepare("PRAGMA table_info(reading_entries)").all().map((c) => c.name));
  if (!rcols.has("verse_key")) database.exec("ALTER TABLE reading_entries ADD COLUMN verse_key TEXT");
  if (!rcols.has("read_at")) database.exec("ALTER TABLE reading_entries ADD COLUMN read_at TEXT");

  // Achievements need to know WHOSE hafalan a lesson recorded. `lessons.teacher_id`
  // is only who logged it, and the monitored roster (students) arrived from a
  // separate Sheet tab than the login accounts (profiles) — so the two are linked
  // explicitly here. NULL = unlinked, which simply earns no personal hafalan
  // points. scripts/link-roster-accounts.mjs matches most of them by name.
  const scols = new Set(database.prepare("PRAGMA table_info(students)").all().map((c) => c.name));
  if (!scols.has("profile_id")) {
    database.exec("ALTER TABLE students ADD COLUMN profile_id TEXT REFERENCES profiles(id)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_students_profile ON students(profile_id)");
  }

  // Ilmu Bank: a note becomes visible to the rest of the centre when shared_at
  // is set. topic/age_group are the filters teachers actually browse by.
  // NOTE: sharing exposes the SUMMARY only — never raw_text. A transcript of
  // someone else's talk is their content, not ours to redistribute.
  const ncols = new Set(database.prepare("PRAGMA table_info(notes)").all().map((c) => c.name));
  if (!ncols.has("shared_at")) database.exec("ALTER TABLE notes ADD COLUMN shared_at TEXT");
  if (!ncols.has("topic")) database.exec("ALTER TABLE notes ADD COLUMN topic TEXT");
  if (!ncols.has("age_group")) database.exec("ALTER TABLE notes ADD COLUMN age_group TEXT");
  database.exec("CREATE INDEX IF NOT EXISTS idx_notes_shared ON notes(shared_at DESC)");

  // Azan: per-user auto-play preferences, uploaded custom sounds, and web-push
  // subscriptions (one row per device). `kv` holds the server's VAPID keypair
  // so push keeps working across deploys without extra env configuration.
  database.exec(`
    CREATE TABLE IF NOT EXISTS azan_settings (
      teacher_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
      muted INTEGER NOT NULL DEFAULT 0,
      country TEXT NOT NULL DEFAULT 'auto', -- COUNTRIES code, or 'auto' (resolve from tz)
      tz TEXT,                              -- IANA timezone reported by the device
      prayers TEXT NOT NULL,                -- JSON: { Fajr: {enabled, sound}, ... }
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS azan_sounds (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      ext TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_azan_sounds_teacher ON azan_sounds(teacher_id);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_subs_teacher ON push_subscriptions(teacher_id);

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    /* ---------------------------------------------------------------------
       Event invitations (Maulid 2026 and onward).

       Guests are NOT profiles — they never log in. Each guest row carries an
       unguessable token that is the whole of their authentication: the URL
       /i/<token> IS the credential, so tokens are 32 hex chars (128 bits) and
       must never be logged or put in a redirect the browser can leak.

       Events are reusable: cloning an event copies its guest rows with fresh
       tokens, so last year's Maulid list seeds this year's without re-import.
       --------------------------------------------------------------------- */
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      host_name TEXT,
      starts_at TEXT,              -- ISO, Asia/Singapore wall time
      ends_at TEXT,
      venue_name TEXT,
      venue_address TEXT,
      venue_map_url TEXT,
      dress_code TEXT,
      rsvp_deadline TEXT,
      support_url TEXT,            -- Shopify product for contributions
      ask_photo INTEGER NOT NULL DEFAULT 1,
      ask_dietary INTEGER NOT NULL DEFAULT 1,
      max_party_size INTEGER NOT NULL DEFAULT 10,
      theme_json TEXT,             -- approved design spec (see lib/events/theme.js)
      theme_draft_json TEXT,       -- unapproved generation awaiting review
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'live', 'closed')),
      created_by TEXT REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_guests (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      family_name TEXT,            -- used to name the Drive photo file
      email TEXT,
      phone TEXT,                  -- E.164, normalised on import
      lang TEXT NOT NULL DEFAULT 'en',
      invited_party_size INTEGER NOT NULL DEFAULT 2,
      sent_email_at TEXT,
      sent_wa_at TEXT,
      opened_at TEXT,
      reminder_count INTEGER NOT NULL DEFAULT 0,
      last_reminder_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_guests_event ON event_guests(event_id);

    CREATE TABLE IF NOT EXISTS event_rsvps (
      guest_id TEXT PRIMARY KEY REFERENCES event_guests(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      attending TEXT NOT NULL CHECK (attending IN ('yes', 'no', 'maybe')),
      adults INTEGER NOT NULL DEFAULT 0,
      children INTEGER NOT NULL DEFAULT 0,
      extra_names TEXT,
      dietary TEXT,
      message TEXT,
      photo_drive_id TEXT,         -- Drive file id returned by the Apps Script
      photo_consent INTEGER NOT NULL DEFAULT 0,
      checked_in_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps(event_id, attending);
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

  // ---- Achievements demo data (dev only) ------------------------------
  // Link two roster rows to login accounts so personal hafalan scores have an
  // owner (in production scripts/link-roster-accounts.mjs does this by name).
  database.prepare("UPDATE students SET profile_id = ? WHERE id = ?").run(teacher1.id, 9001);
  database.prepare("UPDATE students SET profile_id = ? WHERE id = ?").run(teacher2.id, 9003);

  // A recognised certificate catalogue to start from.
  const insertCertType = database.prepare(
    "INSERT INTO cert_types (id, name, description, active, created_at) VALUES (?, ?, ?, 1, ?)"
  );
  for (const [name, desc] of [
    ["ARS Certification", "Al-Qur'an Recitation Specialist"],
    ["Tajweed Level 1", "Foundational tajweed certification"],
    ["Tajweed Level 2", "Intermediate tajweed certification"],
    ["First Aid & CPR", "Workplace first-aid certification"],
    ["Early Childhood Care", "ECDA-recognised childcare training"],
  ]) {
    insertCertType.run(randomUUID(), name, desc, now);
  }

  // A reading streak for teacher1: the last 9 consecutive days, so the 7-day
  // streak badge and its bonus are visible immediately in dev.
  const insertActivity = database.prepare(
    "INSERT INTO reader_activity (teacher_id, date, seconds, updated_at) VALUES (?, ?, ?, ?)"
  );
  const sgDateNDaysAgo = (n) =>
    new Date(Date.now() - n * dayMs).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  for (let i = 0; i < 9; i++) {
    insertActivity.run(teacher1.id, sgDateNDaysAgo(i), i % 3 === 0 ? 1500 : 240, now);
  }
  insertActivity.run(teacher2.id, sgDateNDaysAgo(0), 90, now);

  // One honour of each kind, plus a pending peer nomination to review.
  const insertHonour = database.prepare(
    "INSERT INTO honours (id, teacher_id, kind, title, reason, month, awarded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const lastMonth = new Date(Date.now() - 31 * dayMs)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" })
    .slice(0, 7);
  insertHonour.run(randomUUID(), teacher1.id, "monthly", "Teacher of the Month", "Outstanding consistency with her halaqah.", lastMonth, admin.id, now);
  insertHonour.run(randomUUID(), teacher2.id, "oneoff", "Above and Beyond", "Covered two shifts at short notice.", null, admin.id, now);

  database
    .prepare(
      "INSERT INTO nominations (id, nominee_id, nominator_id, reason, month, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
    )
    .run(
      randomUUID(), teacher2.id, teacher1.id,
      "Stayed back to help a struggling student finish her juz.",
      new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }).slice(0, 7),
      now
    );
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

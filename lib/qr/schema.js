/* The QR Registration tables, as one SQL string.

   Extracted from lib/db.js so the test suite can stand the same schema up in a
   throwaway database. The guards that matter — one expected person cannot be
   marked present twice, and one party cannot hold two generated photos — are
   UNIQUE constraints, i.e. they live HERE and not in application code. A test
   reciting its own copy of this DDL would keep passing after the real
   constraint was dropped.

   A qr_event is its own entity, not a column on an invitation event: an event
   Karim runs for his students has an attendance list and nothing else in
   common with a Maulid invitation. */
export const QR_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS qr_events (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    venue_name TEXT,
    starts_at TEXT,
    intro TEXT,                   -- what the check-in page says
    fields_json TEXT,             -- the extra details asked at check-in
    -- draft: the door link is dead. open: families can check in.
    -- closed: check-in is shut, but passes and photos still work — an event
    -- does not stop existing the moment the hall empties.
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'open', 'closed')),

    -- The family-photo feature. Off unless Karim turns it on per event.
    photo_enabled INTEGER NOT NULL DEFAULT 0,
    photo_prompt TEXT,            -- what he wants the generated picture to be
    photo_blurb TEXT,             -- how the pass invites a family to send one
    photo_consent_text TEXT,      -- what the parent is agreeing to, in his words

    created_by TEXT REFERENCES profiles(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- The uploaded artwork the generated photo is built from: background
  -- template, event logo, company logo, sponsor logo, and whatever else he
  -- adds later. A table rather than columns because "etc." was explicit —
  -- a new kind is a new row, not a migration.
  CREATE TABLE IF NOT EXISTS qr_event_assets (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,           -- background | event_logo | company_logo | sponsor_logo | detail | extra
    label TEXT,                   -- his own name for it, shown in the studio
    file_name TEXT NOT NULL,      -- on the persistent volume, never in the DB
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_qr_assets_event ON qr_event_assets(qr_event_id, position);

  -- Who is expected, imported from a CSV: a name and a class, which is how
  -- Karim's events are actually organised. The point of the table is the
  -- people who have NOT arrived yet.
  CREATE TABLE IF NOT EXISTS qr_expected (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    search_name TEXT NOT NULL,    -- lowercased, for the door's type-ahead
    class_name TEXT,
    phone TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_qr_expected_event ON qr_expected(qr_event_id, search_name);

  -- One party checking in together — a family, with its own pass.
  CREATE TABLE IF NOT EXISTS qr_registrations (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,   -- 8 chars, the ambiguity-free alphabet
    family_name TEXT NOT NULL,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    answers_json TEXT,            -- the event's extra questions, {fieldId: answer}
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_qr_registrations_event ON qr_registrations(qr_event_id, created_at);

  -- ATTENDANCE: one row per person actually present, each with a name and a
  -- class. Students matched off the expected list carry expected_id; family
  -- members added on the day do not. One table, because "who was in the room"
  -- is one question.
  CREATE TABLE IF NOT EXISTS qr_attendance (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    registration_id TEXT NOT NULL REFERENCES qr_registrations(id) ON DELETE CASCADE,
    -- UNIQUE so one expected person cannot be marked present twice: without it
    -- a second party claiming the same student silently doubles the headcount
    -- and "still to arrive" lies for the rest of the day. NULLs do not collide
    -- in SQLite, so any number of unlisted family members is fine.
    expected_id TEXT REFERENCES qr_expected(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    class_name TEXT,
    kind TEXT NOT NULL DEFAULT 'child' CHECK (kind IN ('adult', 'child')),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(expected_id)
  );
  CREATE INDEX IF NOT EXISTS idx_qr_attendance_event ON qr_attendance(qr_event_id);
  CREATE INDEX IF NOT EXISTS idx_qr_attendance_reg ON qr_attendance(registration_id, position);

  -- The generated family picture.
  --
  -- There is NO column for the photo the parent uploaded, and that is the
  -- point: the upload is held in memory for the length of one request, sent to
  -- Gemini, and dropped. Only the generated image reaches the disk. Consent is
  -- stamped here with the wording that was on screen at the time, because
  -- "they agreed" is worth nothing without what they agreed to.
  CREATE TABLE IF NOT EXISTS qr_photos (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    registration_id TEXT NOT NULL REFERENCES qr_registrations(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed')),
    file_name TEXT,               -- on the persistent volume
    mime TEXT,
    bytes INTEGER,
    prompt_used TEXT,             -- what was actually sent, for when one comes out odd
    error TEXT,
    consent_text TEXT NOT NULL,
    consent_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(registration_id)
  );
  CREATE INDEX IF NOT EXISTS idx_qr_photos_event ON qr_photos(qr_event_id, created_at);
`;

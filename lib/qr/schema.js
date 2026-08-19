/* The QR Registration tables, as one SQL string.

   Extracted from lib/db.js so the test suite can stand the same schema up in a
   throwaway database. The three guards that matter on the day — a booth cannot
   be awarded twice, a prize cannot be given twice, a name on the guest list
   cannot be claimed by two families — are UNIQUE constraints, i.e. they live
   HERE and not in application code. A test reciting its own copy of this DDL
   would be testing a copy, and would keep passing after the real constraint
   was dropped.

   A qr_event is its OWN thing, not a column on an invitation event. A booth
   trail belongs to open houses and fun days that have no guest list, no RSVP
   and no contribution — making one wait on an invitation event was backwards. */
export const QR_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS qr_events (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    venue_name TEXT,
    starts_at TEXT,
    intro TEXT,                  -- what the check-in page says
    word TEXT,                   -- the word the booths spell
    pin TEXT,                    -- shared staff PIN, rotated per event
    tiers_json TEXT,             -- [{at, label}] — editable on the morning
    classes_json TEXT,           -- class options on the form
    -- draft: the door link is dead. open: families can check in and booths
    -- award. closed: check-in is shut, but passes and the board still read —
    -- an event does not stop existing the moment the hall empties.
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'open', 'closed')),
    created_by TEXT REFERENCES profiles(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qr_booths (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,   -- 0-based; picks the letter out of word
    created_at TEXT NOT NULL,
    UNIQUE(qr_event_id, position)
  );
  CREATE INDEX IF NOT EXISTS idx_qr_booths_event ON qr_booths(qr_event_id, position);

  -- Who is expected, imported from a CSV. Its own table rather than a column
  -- on the family, because the point is the people who have NOT arrived yet.
  CREATE TABLE IF NOT EXISTS qr_invitees (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    search_name TEXT NOT NULL,   -- lowercased, for the door's type-ahead
    phone TEXT,
    note TEXT,                   -- free column from the CSV (class, table, group)
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_qr_invitees_event ON qr_invitees(qr_event_id, search_name);

  CREATE TABLE IF NOT EXISTS qr_families (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,  -- 8 chars, the ambiguity-free alphabet
    -- The guest list entry this family checked in against. UNIQUE so one name
    -- cannot be claimed twice: without it a second family picking the same
    -- name silently takes over the first family's place on the list, and the
    -- "still to arrive" count lies for the rest of the day.
    invitee_id TEXT REFERENCES qr_invitees(id) ON DELETE SET NULL,
    surname TEXT NOT NULL,
    nickname TEXT,               -- the ONLY name the public leaderboard shows
    parent_name TEXT,
    phone TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(invitee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_qr_families_event ON qr_families(qr_event_id, created_at);

  -- Everyone on the pass, named. Adults and children in one table because a
  -- family adds "who is with me" as one list, not as two counters.
  CREATE TABLE IF NOT EXISTS qr_members (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES qr_families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'child' CHECK (kind IN ('adult', 'child')),
    class_name TEXT,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_qr_members_family ON qr_members(family_id, position);

  -- One row per booth a family has visited. The UNIQUE constraint IS the
  -- double-scan guard: volunteers double-tap and families wander back, and
  -- enforcing it in the schema means no code path can award twice, however
  -- the write arrives.
  CREATE TABLE IF NOT EXISTS qr_visits (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL REFERENCES qr_families(id) ON DELETE CASCADE,
    booth_id TEXT NOT NULL REFERENCES qr_booths(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(family_id, booth_id)
  );
  CREATE INDEX IF NOT EXISTS idx_qr_visits_event ON qr_visits(qr_event_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_qr_visits_booth ON qr_visits(booth_id);

  -- Prizes handed over. UNIQUE for the same reason: a prize given twice is a
  -- real cost, and the counter is a queue of tired volunteers.
  CREATE TABLE IF NOT EXISTS qr_claims (
    id TEXT PRIMARY KEY,
    qr_event_id TEXT NOT NULL REFERENCES qr_events(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL REFERENCES qr_families(id) ON DELETE CASCADE,
    tier_index INTEGER NOT NULL,
    tier_label TEXT NOT NULL,   -- snapshot: tiers can be edited after a claim
    created_at TEXT NOT NULL,
    UNIQUE(family_id, tier_index)
  );
  CREATE INDEX IF NOT EXISTS idx_qr_claims_event ON qr_claims(qr_event_id, created_at);
`;

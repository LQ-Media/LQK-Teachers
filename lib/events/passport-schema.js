/* The QR-passport tables, as one SQL string.

   Extracted from lib/db.js so the test suite can stand the same schema up in a
   throwaway database. The two guards that matter on the day — a booth cannot
   be awarded twice, a prize cannot be given twice — are UNIQUE constraints,
   i.e. they live HERE and not in application code. A test that recited its own
   copy of this DDL would be testing a copy, and would keep passing after the
   real constraint was dropped. */
export const PASSPORT_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS event_booths (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,   -- 0-based; picks the letter out of qr_word
      created_at TEXT NOT NULL,
      UNIQUE(event_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_event_booths_event ON event_booths(event_id, position);

    CREATE TABLE IF NOT EXISTS event_families (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,  -- 8 chars, the ambiguity-free alphabet
      surname TEXT NOT NULL,
      nickname TEXT,               -- the ONLY name the public leaderboard shows
      parent_name TEXT,
      phone TEXT,
      adults INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_families_event ON event_families(event_id, created_at);

    CREATE TABLE IF NOT EXISTS event_family_children (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES event_families(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      class_name TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_event_family_children ON event_family_children(family_id, position);

    -- One row per booth a family has visited. The UNIQUE constraint IS the
    -- double-scan guard: volunteers double-tap and families wander back, and
    -- enforcing it in the schema means no code path can award twice, however
    -- the write arrives.
    CREATE TABLE IF NOT EXISTS event_visits (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      family_id TEXT NOT NULL REFERENCES event_families(id) ON DELETE CASCADE,
      booth_id TEXT NOT NULL REFERENCES event_booths(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(family_id, booth_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_visits_event ON event_visits(event_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_event_visits_booth ON event_visits(booth_id);

    -- Prizes handed over. UNIQUE for the same reason: a prize given twice is a
    -- real cost, and the counter is a queue of tired volunteers.
    CREATE TABLE IF NOT EXISTS event_claims (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      family_id TEXT NOT NULL REFERENCES event_families(id) ON DELETE CASCADE,
      tier_index INTEGER NOT NULL,
      tier_label TEXT NOT NULL,   -- snapshot: tiers can be edited after a claim
      created_at TEXT NOT NULL,
      UNIQUE(family_id, tier_index)
    );
    CREATE INDEX IF NOT EXISTS idx_event_claims_event ON event_claims(event_id, created_at);
  `;

import "server-only";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import {
  TOKEN_ALPHABET,
  TOKEN_LENGTH,
  parseTiers,
  tierState,
  wordLetters,
} from "./passport";

/* Reads and writes for QR Registration — the on-the-day half of an event.

   Every read leaves through plain()/plainAll(): node:sqlite hands back rows
   with a NULL PROTOTYPE, and React refuses to serialise those to a Client
   Component. The failure appears at runtime, on one page, never at build time.
   (The same note guards lib/events/queries.js — this is not a new hazard, it
   is the same one, and it bites once per module.) */
function plain(row) {
  return row ? { ...row } : row;
}

function plainAll(rows) {
  return rows.map((r) => ({ ...r }));
}

function nowIso() {
  return new Date().toISOString();
}

/* ---- pass tokens -------------------------------------------------------- */

/* Drawn from crypto randomness and rejection-sampled, not `% alphabet.length`.
   The modulo shortcut biases the first 16 symbols of a 30-symbol alphabet
   upward, and a biased token space is a smaller token space. */
function randomToken() {
  const out = [];
  while (out.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH * 2)) {
      if (byte >= 256 - (256 % TOKEN_ALPHABET.length)) continue; // reject the biased tail
      out.push(TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]);
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out.join("");
}

function uniqueToken(db) {
  const taken = db.prepare("SELECT 1 FROM event_families WHERE token = ?");
  for (let attempt = 0; attempt < 12; attempt++) {
    const token = randomToken();
    if (!taken.get(token)) return token;
  }
  // 30^8 with a few hundred families — twelve straight collisions means
  // something is wrong with the randomness, not with luck.
  throw new Error("Could not allocate a unique pass token");
}

/* ---- event config ------------------------------------------------------- */

export function getQrEvent(eventId) {
  const db = getDb();
  const event = plain(db.prepare("SELECT * FROM events WHERE id = ?").get(eventId));
  if (!event) return null;
  return decorate(event);
}

/* The public door page looks an event up by slug, and MUST NOT find one whose
   QR registration is switched off — a draft's check-in link is a link Karim is
   still editing, and a family that follows it registers into a half-built
   event. */
export function getPublicQrEvent(slug) {
  const db = getDb();
  const event = plain(db.prepare("SELECT * FROM events WHERE slug = ?").get(slug));
  if (!event || !event.qr_enabled) return null;
  return decorate(event);
}

function decorate(event) {
  const db = getDb();
  const booths = plainAll(
    db
      .prepare("SELECT * FROM event_booths WHERE event_id = ? ORDER BY position")
      .all(event.id),
  );
  const letters = wordLetters(event.qr_word);
  return {
    ...event,
    booths: booths.map((booth) => ({ ...booth, letter: letters[booth.position] || "?" })),
    letters,
    tiers: parseTiers(event.qr_tiers_json),
    classes: parseClasses(event.qr_classes_json),
  };
}

function parseClasses(json) {
  try {
    const raw = JSON.parse(json || "[]");
    return Array.isArray(raw) ? raw.map((c) => String(c).trim()).filter(Boolean).slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function saveQrConfig(eventId, config) {
  const db = getDb();
  db.prepare(
    `UPDATE events SET qr_enabled = ?, qr_word = ?, qr_pin = ?, qr_tiers_json = ?,
       qr_intro = ?, qr_classes_json = ?, updated_at = ? WHERE id = ?`,
  ).run(
    config.enabled ? 1 : 0,
    config.word || null,
    config.pin || null,
    JSON.stringify(parseTiers(JSON.stringify(config.tiers || []))),
    config.intro || null,
    JSON.stringify(config.classes || []),
    nowIso(),
    eventId,
  );
}

/* Booths are rewritten wholesale rather than diffed. Positions are what bind a
   booth to its letter, so a partial update can silently re-letter the hall;
   replacing the set keeps position == index by construction.

   Existing booths are matched BY NAME so their visits survive a reorder — a
   volunteer who has already awarded 40 families should not lose them because
   Karim renamed the booth next to theirs. */
export function replaceBooths(eventId, names) {
  const db = getDb();
  const clean = names.map((n) => String(n || "").trim()).filter(Boolean).slice(0, 26);
  const existing = plainAll(db.prepare("SELECT * FROM event_booths WHERE event_id = ?").all(eventId));
  const byName = new Map(existing.map((b) => [b.name.toLowerCase(), b]));

  db.exec("BEGIN");
  try {
    // Park every row out of the 0..n-1 range first: UNIQUE(event_id, position)
    // rejects a straight reorder mid-flight ("swap booth 1 and 2" collides on
    // whichever moves first).
    db.prepare("UPDATE event_booths SET position = position + 1000 WHERE event_id = ?").run(eventId);

    const keptIds = [];
    clean.forEach((name, index) => {
      const match = byName.get(name.toLowerCase());
      if (match) {
        db.prepare("UPDATE event_booths SET name = ?, position = ? WHERE id = ?").run(name, index, match.id);
        keptIds.push(match.id);
      } else {
        const id = randomUUID();
        db.prepare(
          "INSERT INTO event_booths (id, event_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(id, eventId, name, index, nowIso());
        keptIds.push(id);
      }
    });

    // Whatever is still parked above 1000 was removed from the list.
    const stale = existing.filter((b) => !keptIds.includes(b.id));
    for (const booth of stale) {
      db.prepare("DELETE FROM event_booths WHERE id = ?").run(booth.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/* ---- the staff PIN ------------------------------------------------------ */

/* One shared PIN, not accounts: an event is one day and one team, and a
   volunteer holding a borrowed phone has no portal login. It keeps parents out
   of the booth screens — it is NOT authentication, and it is rotated per event.

   Compared in constant time. A four-digit PIN over an unthrottled endpoint is
   guessable in an afternoon anyway; leaking the prefix through timing would
   make it guessable in a minute. */
export function pinMatches(event, candidate) {
  const expected = String(event?.qr_pin || "");
  const given = String(candidate || "");
  if (!expected || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/* ---- families ----------------------------------------------------------- */

export function registerFamily(eventId, input) {
  const db = getDb();
  const id = randomUUID();
  const token = uniqueToken(db);
  const ts = nowIso();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO event_families (id, event_id, token, surname, nickname, parent_name, phone, adults, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      eventId,
      token,
      input.surname,
      input.nickname || null,
      input.parentName || null,
      input.phone || null,
      input.adults || 1,
      ts,
    );
    (input.children || []).forEach((child, index) => {
      db.prepare(
        `INSERT INTO event_family_children (id, family_id, name, class_name, position)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), id, child.name, child.className || null, index);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { id, token };
}

export function getFamilyByToken(token) {
  const db = getDb();
  const family = plain(db.prepare("SELECT * FROM event_families WHERE token = ?").get(token));
  if (!family) return null;
  const event = getQrEvent(family.event_id);
  if (!event) return null;
  return { family, event };
}

export function familyChildren(familyId) {
  const db = getDb();
  return plainAll(
    db
      .prepare("SELECT * FROM event_family_children WHERE family_id = ? ORDER BY position")
      .all(familyId),
  );
}

/* ---- the passport ------------------------------------------------------- */

/**
 * Everything one family's pass needs: their booths with a collected flag and
 * the letter each carries, the count, and their tier state.
 *
 * `event` is passed in rather than re-fetched — the pass page, the booth screen
 * and the prize counter all already hold it, and re-reading it per call turns
 * one page render into four queries.
 */
export function passportFor(event, family) {
  const db = getDb();
  const visits = plainAll(
    db.prepare("SELECT * FROM event_visits WHERE family_id = ?").all(family.id),
  );
  const visitedAt = new Map(visits.map((v) => [v.booth_id, v.created_at]));

  const stops = event.booths.map((booth) => ({
    id: booth.id,
    name: booth.name,
    letter: booth.letter,
    position: booth.position,
    collected: visitedAt.has(booth.id),
    collectedAt: visitedAt.get(booth.id) || null,
  }));

  const claimed = new Set(
    db
      .prepare("SELECT tier_index FROM event_claims WHERE family_id = ?")
      .all(family.id)
      .map((row) => row.tier_index),
  );

  const collected = stops.filter((s) => s.collected).length;
  return {
    stops,
    collected,
    total: stops.length,
    complete: stops.length > 0 && collected === stops.length,
    tiers: tierState(event.tiers, collected, claimed),
  };
}

/* The one write that matters on the day.

   A repeat scan is NOT an error and must not read as one: volunteers double-tap
   and families wander back to a booth they liked. The UNIQUE(family_id,
   booth_id) constraint decides it, and this reports `already` so the booth
   screen can say "already collected — wave them on" rather than either failing
   or silently doing nothing. */
export function awardBooth(eventId, familyId, boothId) {
  const db = getDb();
  const booth = plain(
    db.prepare("SELECT * FROM event_booths WHERE id = ? AND event_id = ?").get(boothId, eventId),
  );
  if (!booth) return { ok: false, error: "That booth is not part of this event." };

  try {
    db.prepare(
      "INSERT INTO event_visits (id, event_id, family_id, booth_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), eventId, familyId, boothId, nowIso());
    return { ok: true, already: false };
  } catch (error) {
    // The constraint firing is the expected path, not an exception to log.
    if (String(error?.message || "").includes("UNIQUE")) return { ok: true, already: true };
    throw error;
  }
}

/* Hands a prize over.

   The threshold is re-checked HERE, server-side, not just in the UI that hides
   the button. A server action is a public HTTP endpoint reachable by direct
   POST, and a prize given early is a real cost that nobody can take back. */
export function claimTier(event, family, tierIndex) {
  const db = getDb();
  const passport = passportFor(event, family);
  const tier = passport.tiers[tierIndex];
  if (!tier) return { ok: false, error: "That reward is not part of this event." };
  if (!tier.earned) {
    return { ok: false, error: `Not yet — ${tier.remaining} more booth${tier.remaining === 1 ? "" : "s"} to go.` };
  }

  try {
    db.prepare(
      `INSERT INTO event_claims (id, event_id, family_id, tier_index, tier_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), event.id, family.id, tierIndex, tier.label, nowIso());
    return { ok: true, already: false, tier };
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE")) return { ok: true, already: true, tier };
    throw error;
  }
}

/* ---- the hall screens --------------------------------------------------- */

/* The leaderboard goes on a TV in the hall, so it selects the NICKNAME and the
   surname and nothing else — never a child's name, never a phone number. The
   query is the enforcement; a component that only chooses not to render a
   field is one refactor away from rendering it. */
export function leaderboard(eventId, limit = 20) {
  const db = getDb();
  return plainAll(
    db
      .prepare(
        `SELECT f.id, f.nickname, f.surname, COUNT(v.id) AS collected, MAX(v.created_at) AS last_at
           FROM event_families f
           LEFT JOIN event_visits v ON v.family_id = f.id
          WHERE f.event_id = ?
          GROUP BY f.id
         HAVING collected > 0
          ORDER BY collected DESC, last_at ASC
          LIMIT ?`,
      )
      .all(eventId, limit),
  );
}

export function qrStats(eventId) {
  const db = getDb();
  const families = db
    .prepare("SELECT COUNT(*) AS n FROM event_families WHERE event_id = ?")
    .get(eventId).n;
  const children = db
    .prepare(
      `SELECT COUNT(*) AS n FROM event_family_children c
         JOIN event_families f ON f.id = c.family_id WHERE f.event_id = ?`,
    )
    .get(eventId).n;
  const visits = db
    .prepare("SELECT COUNT(*) AS n FROM event_visits WHERE event_id = ?")
    .get(eventId).n;
  const prizes = db
    .prepare("SELECT COUNT(*) AS n FROM event_claims WHERE event_id = ?")
    .get(eventId).n;

  const perBooth = plainAll(
    db
      .prepare(
        `SELECT b.id, b.name, b.position, COUNT(v.id) AS visits
           FROM event_booths b
           LEFT JOIN event_visits v ON v.booth_id = b.id
          WHERE b.event_id = ?
          GROUP BY b.id
          ORDER BY b.position`,
      )
      .all(eventId),
  );

  const finished = db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT f.id FROM event_families f
           JOIN event_visits v ON v.family_id = f.id
          WHERE f.event_id = ?
          GROUP BY f.id
         HAVING COUNT(v.id) >= (SELECT COUNT(*) FROM event_booths WHERE event_id = ?)
       )`,
    )
    .get(eventId, eventId).n;

  return { families, children, visits, prizes, perBooth, finished };
}

export function listFamilies(eventId) {
  const db = getDb();
  return plainAll(
    db
      .prepare(
        `SELECT f.*, COUNT(v.id) AS collected
           FROM event_families f
           LEFT JOIN event_visits v ON v.family_id = f.id
          WHERE f.event_id = ?
          GROUP BY f.id
          ORDER BY f.created_at DESC`,
      )
      .all(eventId),
  );
}

/** Every event with QR registration switched on — the booth phone's picker. */
export function listQrEvents() {
  const db = getDb();
  return plainAll(
    db
      .prepare(
        "SELECT id, slug, title, starts_at FROM events WHERE qr_enabled = 1 ORDER BY COALESCE(starts_at, created_at) DESC",
      )
      .all(),
  );
}

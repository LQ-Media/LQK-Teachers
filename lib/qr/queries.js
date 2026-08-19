import "server-only";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { TOKEN_ALPHABET, TOKEN_LENGTH, parseTiers, tierState, wordLetters } from "./passport";
import { searchName } from "./csv";

/* Reads and writes for QR Registration.

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

function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "event"
  );
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
  const taken = db.prepare("SELECT 1 FROM qr_families WHERE token = ?");
  for (let attempt = 0; attempt < 12; attempt++) {
    const token = randomToken();
    if (!taken.get(token)) return token;
  }
  // 30^8 with a few hundred families — twelve straight collisions means
  // something is wrong with the randomness, not with luck.
  throw new Error("Could not allocate a unique pass token");
}

/* ---- the event ---------------------------------------------------------- */

export function createQrEvent({ title, venueName, startsAt, createdBy }) {
  const db = getDb();
  const id = randomUUID();
  const ts = nowIso();
  let slug = slugify(title);
  const taken = db.prepare("SELECT 1 FROM qr_events WHERE slug = ?");
  let n = 1;
  while (taken.get(slug)) slug = `${slugify(title)}-${++n}`;

  db.prepare(
    `INSERT INTO qr_events (id, slug, title, venue_name, starts_at, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).run(id, slug, title, venueName || null, startsAt || null, createdBy || null, ts, ts);
  return { id, slug };
}

export function listQrEvents() {
  const db = getDb();
  return plainAll(
    db
      .prepare(
        `SELECT e.*,
                (SELECT COUNT(*) FROM qr_families f WHERE f.qr_event_id = e.id) AS family_count,
                (SELECT COUNT(*) FROM qr_invitees i WHERE i.qr_event_id = e.id) AS invitee_count,
                (SELECT COUNT(*) FROM qr_booths b WHERE b.qr_event_id = e.id) AS booth_count
           FROM qr_events e
          ORDER BY COALESCE(e.starts_at, e.created_at) DESC`,
      )
      .all(),
  );
}

export function getQrEvent(id) {
  const db = getDb();
  const event = plain(db.prepare("SELECT * FROM qr_events WHERE id = ?").get(id));
  return event ? decorate(event) : null;
}

/* The door page looks an event up by slug and MUST NOT find one that is not
   OPEN — a draft's check-in link is a link Karim is still editing, and a family
   that follows it registers into a half-built event. */
export function getOpenQrEvent(slug) {
  const db = getDb();
  const event = plain(db.prepare("SELECT * FROM qr_events WHERE slug = ?").get(slug));
  if (!event || event.status !== "open") return null;
  return decorate(event);
}

/* The pass and the board keep working after check-in shuts. An event does not
   stop existing the moment the hall empties, and a family looking at their
   pass on the bus home should not meet a 404. */
export function getPublicQrEvent(slug) {
  const db = getDb();
  const event = plain(db.prepare("SELECT * FROM qr_events WHERE slug = ?").get(slug));
  if (!event || event.status === "draft") return null;
  return decorate(event);
}

function decorate(event) {
  const db = getDb();
  const booths = plainAll(
    db.prepare("SELECT * FROM qr_booths WHERE qr_event_id = ? ORDER BY position").all(event.id),
  );
  const letters = wordLetters(event.word);
  return {
    ...event,
    booths: booths.map((booth) => ({ ...booth, letter: letters[booth.position] || "?" })),
    letters,
    tiers: parseTiers(event.tiers_json),
    classes: parseClasses(event.classes_json),
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

export function saveQrConfig(id, config) {
  const db = getDb();
  db.prepare(
    `UPDATE qr_events SET title = ?, venue_name = ?, status = ?, word = ?, pin = ?,
       tiers_json = ?, intro = ?, classes_json = ?, updated_at = ? WHERE id = ?`,
  ).run(
    config.title,
    config.venueName || null,
    config.status,
    config.word || null,
    config.pin || null,
    JSON.stringify(parseTiers(JSON.stringify(config.tiers || []))),
    config.intro || null,
    JSON.stringify(config.classes || []),
    nowIso(),
    id,
  );
}

export function deleteQrEvent(id) {
  const db = getDb();
  db.prepare("DELETE FROM qr_events WHERE id = ?").run(id);
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
  const existing = plainAll(db.prepare("SELECT * FROM qr_booths WHERE qr_event_id = ?").all(eventId));
  const byName = new Map(existing.map((b) => [b.name.toLowerCase(), b]));

  db.exec("BEGIN");
  try {
    // Park every row out of the 0..n-1 range first: UNIQUE(qr_event_id,
    // position) rejects a straight reorder mid-flight ("swap booth 1 and 2"
    // collides on whichever moves first).
    db.prepare("UPDATE qr_booths SET position = position + 1000 WHERE qr_event_id = ?").run(eventId);

    const keptIds = [];
    clean.forEach((name, index) => {
      const match = byName.get(name.toLowerCase());
      if (match) {
        db.prepare("UPDATE qr_booths SET name = ?, position = ? WHERE id = ?").run(name, index, match.id);
        keptIds.push(match.id);
      } else {
        const id = randomUUID();
        db.prepare(
          "INSERT INTO qr_booths (id, qr_event_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(id, eventId, name, index, nowIso());
        keptIds.push(id);
      }
    });

    for (const booth of existing.filter((b) => !keptIds.includes(b.id))) {
      db.prepare("DELETE FROM qr_booths WHERE id = ?").run(booth.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/* ---- the guest list ----------------------------------------------------- */

/**
 * Import parsed CSV rows.
 *
 * Additive by default: a second paste ADDS the people who weren't there, which
 * is what actually happens ("three more families just confirmed"). `replace`
 * wipes first, and deliberately keeps anyone who has already checked in —
 * deleting a claimed invitee would orphan a family that is standing in the
 * hall holding a pass.
 */
export function importInvitees(eventId, rows, { replace = false } = {}) {
  const db = getDb();
  const ts = nowIso();
  let added = 0;
  let duplicates = 0;

  db.exec("BEGIN");
  try {
    if (replace) {
      db.prepare(
        `DELETE FROM qr_invitees
          WHERE qr_event_id = ?
            AND id NOT IN (SELECT invitee_id FROM qr_families WHERE invitee_id IS NOT NULL)`,
      ).run(eventId);
    }

    const existing = new Set(
      db
        .prepare("SELECT search_name FROM qr_invitees WHERE qr_event_id = ?")
        .all(eventId)
        .map((r) => r.search_name),
    );

    for (const row of rows) {
      const key = searchName(row.name);
      if (!key || existing.has(key)) {
        duplicates++;
        continue;
      }
      existing.add(key);
      db.prepare(
        `INSERT INTO qr_invitees (id, qr_event_id, name, search_name, phone, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), eventId, row.name, key, row.phone || null, row.note || null, ts);
      added++;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { added, duplicates };
}

export function listInvitees(eventId) {
  const db = getDb();
  return plainAll(
    db
      .prepare(
        `SELECT i.*, f.token AS family_token, f.id AS family_id
           FROM qr_invitees i
           LEFT JOIN qr_families f ON f.invitee_id = i.id
          WHERE i.qr_event_id = ?
          ORDER BY i.name`,
      )
      .all(eventId),
  );
}

export function clearInvitees(eventId) {
  const db = getDb();
  db.prepare(
    `DELETE FROM qr_invitees
      WHERE qr_event_id = ?
        AND id NOT IN (SELECT invitee_id FROM qr_families WHERE invitee_id IS NOT NULL)`,
  ).run(eventId);
}

/* The door's type-ahead.

   Deliberately NOT "return the whole list". The check-in link gets pasted into
   WhatsApp groups, and a page that renders every expected name to anyone who
   opens it publishes the guest list. Two characters is nothing for someone who
   knows their own name and a lot of work for someone enumerating.

   Already-claimed names are excluded: showing a name that cannot be picked
   invites a queue of "it says my name is taken" at the busiest moment. */
export function searchInvitees(eventId, query, limit = 8) {
  const term = searchName(query);
  if (term.length < 2) return [];
  const db = getDb();
  const rows = plainAll(
    db
      .prepare(
        `SELECT i.id, i.name, i.note
           FROM qr_invitees i
           LEFT JOIN qr_families f ON f.invitee_id = i.id
          WHERE i.qr_event_id = ? AND f.id IS NULL AND i.search_name LIKE ?
          ORDER BY CASE WHEN i.search_name LIKE ? THEN 0 ELSE 1 END, i.name
          LIMIT ?`,
      )
      .all(eventId, `%${term}%`, `${term}%`, limit),
  );
  return rows;
}

export function inviteeStats(eventId) {
  const db = getDb();
  const total = db
    .prepare("SELECT COUNT(*) AS n FROM qr_invitees WHERE qr_event_id = ?")
    .get(eventId).n;
  const arrived = db
    .prepare(
      `SELECT COUNT(*) AS n FROM qr_invitees i
         JOIN qr_families f ON f.invitee_id = i.id
        WHERE i.qr_event_id = ?`,
    )
    .get(eventId).n;
  return { total, arrived, awaited: Math.max(0, total - arrived) };
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
      `INSERT INTO qr_families (id, qr_event_id, token, invitee_id, surname, nickname, parent_name, phone, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      eventId,
      token,
      input.inviteeId || null,
      input.surname,
      input.nickname || null,
      input.parentName || null,
      input.phone || null,
      ts,
    );
    (input.members || []).forEach((member, index) => {
      db.prepare(
        `INSERT INTO qr_members (id, family_id, name, kind, class_name, position)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        id,
        member.name,
        member.kind === "adult" ? "adult" : "child",
        member.className || null,
        index,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    // UNIQUE(invitee_id): two phones picked the same name within a second of
    // each other. Reported rather than thrown so the door can say so plainly.
    if (String(error?.message || "").includes("UNIQUE") && input.inviteeId) {
      return { taken: true };
    }
    throw error;
  }
  return { id, token };
}

export function getFamilyByToken(token) {
  const db = getDb();
  const family = plain(db.prepare("SELECT * FROM qr_families WHERE token = ?").get(token));
  if (!family) return null;
  const event = getQrEvent(family.qr_event_id);
  if (!event) return null;
  return { family, event };
}

export function familyMembers(familyId) {
  const db = getDb();
  return plainAll(
    db.prepare("SELECT * FROM qr_members WHERE family_id = ? ORDER BY position").all(familyId),
  );
}

/* ---- the staff PIN ------------------------------------------------------ */

/* One shared PIN, not accounts: an event is one day and one team, and a
   volunteer holding a borrowed phone has no portal login. It keeps parents out
   of the booth screens — it is NOT authentication, and it is rotated per event.

   Compared in constant time. A four-digit PIN over an unthrottled endpoint is
   guessable in an afternoon anyway; leaking the prefix through timing would
   make it guessable in a minute. */
export function pinMatches(event, candidate) {
  const expected = String(event?.pin || "");
  const given = String(candidate || "");
  if (!expected || expected.length !== given.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
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
  const visits = plainAll(db.prepare("SELECT * FROM qr_visits WHERE family_id = ?").all(family.id));
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
      .prepare("SELECT tier_index FROM qr_claims WHERE family_id = ?")
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
    db.prepare("SELECT * FROM qr_booths WHERE id = ? AND qr_event_id = ?").get(boothId, eventId),
  );
  if (!booth) return { ok: false, error: "That booth is not part of this event." };

  try {
    db.prepare(
      "INSERT INTO qr_visits (id, qr_event_id, family_id, booth_id, created_at) VALUES (?, ?, ?, ?, ?)",
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
    return {
      ok: false,
      error: `Not yet — ${tier.remaining} more booth${tier.remaining === 1 ? "" : "s"} to go.`,
    };
  }

  try {
    db.prepare(
      `INSERT INTO qr_claims (id, qr_event_id, family_id, tier_index, tier_label, created_at)
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
   surname and nothing else — never a member's name, never a phone number. The
   query is the enforcement; a component that only chooses not to render a
   field is one refactor away from rendering it. */
export function leaderboard(eventId, limit = 20) {
  const db = getDb();
  return plainAll(
    db
      .prepare(
        `SELECT f.id, f.nickname, f.surname, COUNT(v.id) AS collected, MAX(v.created_at) AS last_at
           FROM qr_families f
           LEFT JOIN qr_visits v ON v.family_id = f.id
          WHERE f.qr_event_id = ?
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
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;

  const families = one("SELECT COUNT(*) AS n FROM qr_families WHERE qr_event_id = ?", eventId);
  const members = one(
    `SELECT COUNT(*) AS n FROM qr_members m JOIN qr_families f ON f.id = m.family_id
      WHERE f.qr_event_id = ?`,
    eventId,
  );
  const visits = one("SELECT COUNT(*) AS n FROM qr_visits WHERE qr_event_id = ?", eventId);
  const prizes = one("SELECT COUNT(*) AS n FROM qr_claims WHERE qr_event_id = ?", eventId);

  const perBooth = plainAll(
    db
      .prepare(
        `SELECT b.id, b.name, b.position, COUNT(v.id) AS visits
           FROM qr_booths b
           LEFT JOIN qr_visits v ON v.booth_id = b.id
          WHERE b.qr_event_id = ?
          GROUP BY b.id
          ORDER BY b.position`,
      )
      .all(eventId),
  );

  const finished = one(
    `SELECT COUNT(*) AS n FROM (
       SELECT f.id FROM qr_families f
         JOIN qr_visits v ON v.family_id = f.id
        WHERE f.qr_event_id = ?
        GROUP BY f.id
       HAVING COUNT(v.id) >= (SELECT COUNT(*) FROM qr_booths WHERE qr_event_id = ?)
     )`,
    eventId,
    eventId,
  );

  return { families, members, visits, prizes, perBooth, finished, ...inviteeStats(eventId) };
}

export function listFamilies(eventId) {
  const db = getDb();
  return plainAll(
    db
      .prepare(
        `SELECT f.*, COUNT(v.id) AS collected,
                (SELECT COUNT(*) FROM qr_members m WHERE m.family_id = f.id) AS member_count
           FROM qr_families f
           LEFT JOIN qr_visits v ON v.family_id = f.id
          WHERE f.qr_event_id = ?
          GROUP BY f.id
          ORDER BY f.created_at DESC`,
      )
      .all(eventId),
  );
}

/** Every event a booth phone may sign in to. */
export function listOpenQrEvents() {
  const db = getDb();
  return plainAll(
    db
      .prepare(
        "SELECT id, slug, title, starts_at FROM qr_events WHERE status = 'open' ORDER BY COALESCE(starts_at, created_at) DESC",
      )
      .all(),
  );
}

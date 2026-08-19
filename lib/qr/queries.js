import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { TOKEN_ALPHABET, TOKEN_LENGTH } from "./tokens";
import { parseFields, parseAnswers } from "./fields";
import { searchName } from "./csv";
import { clampPax } from "./pax";
import { isAspect, DEFAULT_ASPECT } from "./asset-kinds";

// Re-exported so server callers keep one import site for queries.
export { clampPax };
import { removeTemplate, removePhoto } from "./assets";

/* Reads and writes for QR Registration.

   Every read leaves through plain()/plainAll(): node:sqlite hands back rows
   with a NULL PROTOTYPE, and React refuses to serialise those to a Client
   Component. The failure appears at runtime, on one page, never at build time.
   (The same note guards lib/events/queries.js — the same hazard, once per
   module.) */
function plain(row) {
  return row ? { ...row } : row;
}

function plainAll(rows) {
  return rows.map((r) => ({ ...r }));
}

const nowIso = () => new Date().toISOString();



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

/* Rejection-sampled, not `% alphabet.length`. The modulo shortcut biases the
   first 16 symbols of a 30-symbol alphabet upward, and a biased token space is
   a smaller token space. */
function randomToken() {
  const out = [];
  while (out.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH * 2)) {
      if (byte >= 256 - (256 % TOKEN_ALPHABET.length)) continue;
      out.push(TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length]);
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out.join("");
}

function uniqueToken(db) {
  const taken = db.prepare("SELECT 1 FROM qr_registrations WHERE token = ?");
  for (let attempt = 0; attempt < 12; attempt++) {
    const token = randomToken();
    if (!taken.get(token)) return token;
  }
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

function decorate(event) {
  const db = getDb();
  return {
    ...event,
    fields: parseFields(event.fields_json),
    assets: plainAll(
      db
        .prepare("SELECT * FROM qr_event_assets WHERE qr_event_id = ? ORDER BY position, created_at")
        .all(event.id),
    ),
  };
}

export function getQrEvent(id) {
  const event = plain(getDb().prepare("SELECT * FROM qr_events WHERE id = ?").get(id));
  return event ? decorate(event) : null;
}

/* The door page looks an event up by slug and MUST NOT find a draft — a
   draft's check-in link is one Karim is still editing, and a family that
   follows it registers into a half-built event. */
export function getOpenQrEvent(slug) {
  const event = plain(getDb().prepare("SELECT * FROM qr_events WHERE slug = ?").get(slug));
  if (!event || event.status !== "open") return null;
  return decorate(event);
}

/* A pass keeps working after check-in shuts. The family photo is the reason:
   the whole point of "add it whenever" is that it still works from the sofa
   that evening, when the hall is empty and the event is closed. */
export function getLiveQrEvent(slug) {
  const event = plain(getDb().prepare("SELECT * FROM qr_events WHERE slug = ?").get(slug));
  if (!event || event.status === "draft") return null;
  return decorate(event);
}

export function listQrEvents() {
  return plainAll(
    getDb()
      .prepare(
        `SELECT e.*,
                (SELECT COUNT(*) FROM qr_registrations r WHERE r.qr_event_id = e.id) AS party_count,
                (SELECT COUNT(*) FROM qr_attendance a WHERE a.qr_event_id = e.id) AS attendance_count,
                (SELECT COUNT(*) FROM qr_expected x WHERE x.qr_event_id = e.id) AS expected_count
           FROM qr_events e
          ORDER BY COALESCE(e.starts_at, e.created_at) DESC`,
      )
      .all(),
  );
}

export function saveQrEvent(id, config) {
  getDb()
    .prepare(
      `UPDATE qr_events SET title = ?, venue_name = ?, starts_at = ?, status = ?, intro = ?,
         fields_json = ?, ask_pax = ?, pax_label = ?, photo_enabled = ?, photo_prompt = ?,
         photo_aspect = ?, photo_blurb = ?, photo_consent_text = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      config.title,
      config.venueName || null,
      config.startsAt || null,
      config.status,
      config.intro || null,
      JSON.stringify(parseFields(config.fields || [])),
      config.askPax ? 1 : 0,
      config.paxLabel || null,
      config.photoEnabled ? 1 : 0,
      config.photoPrompt || null,
      isAspect(config.photoAspect) ? config.photoAspect : DEFAULT_ASPECT,
      config.photoBlurb || null,
      config.photoConsentText || null,
      nowIso(),
      id,
    );
}

/* Files live on the volume, so they have to be swept before the rows that name
   them disappear. ON DELETE CASCADE would take the rows and leave the images
   on disk forever — which for a folder of children's photographs is exactly
   the wrong kind of leftover. */
export function deleteQrEvent(id) {
  const db = getDb();
  for (const row of db.prepare("SELECT file_name FROM qr_event_assets WHERE qr_event_id = ?").all(id)) {
    removeTemplate(row.file_name);
  }
  for (const row of db.prepare("SELECT file_name FROM qr_photos WHERE qr_event_id = ?").all(id)) {
    if (row.file_name) removePhoto(row.file_name);
  }
  db.prepare("DELETE FROM qr_events WHERE id = ?").run(id);
}

/* ---- template artwork --------------------------------------------------- */

export function addAsset(eventId, { kind, label, fileName, mime, bytes }) {
  const db = getDb();
  const id = randomUUID();
  const next =
    db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM qr_event_assets WHERE qr_event_id = ?").get(eventId).n;
  db.prepare(
    `INSERT INTO qr_event_assets (id, qr_event_id, kind, label, file_name, mime, bytes, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, eventId, kind, label || null, fileName, mime, bytes, next, nowIso());
  return id;
}

export function getAsset(id) {
  return plain(getDb().prepare("SELECT * FROM qr_event_assets WHERE id = ?").get(id));
}

export function deleteAsset(id) {
  const db = getDb();
  const asset = getAsset(id);
  if (!asset) return;
  db.prepare("DELETE FROM qr_event_assets WHERE id = ?").run(id);
  removeTemplate(asset.file_name);
}

/* ---- who is expected ---------------------------------------------------- */

/**
 * Import parsed CSV rows.
 *
 * Additive by default: a second paste ADDS the people who weren't there, which
 * is what actually happens ("three more families just confirmed"). `replace`
 * wipes first, and deliberately keeps anyone already marked present —
 * deleting them would orphan an attendance record for someone who was there.
 */
export function importExpected(eventId, rows, { replace = false } = {}) {
  const db = getDb();
  const ts = nowIso();
  let added = 0;
  let duplicates = 0;

  db.exec("BEGIN");
  try {
    if (replace) {
      db.prepare(
        `DELETE FROM qr_expected
          WHERE qr_event_id = ?
            AND id NOT IN (SELECT expected_id FROM qr_attendance WHERE expected_id IS NOT NULL)`,
      ).run(eventId);
    }

    // Matched on name + class, not name alone: two children called Nur Aisyah
    // in different classes are two different students, and collapsing them
    // means one of them can never be marked present.
    const existing = new Set(
      db
        .prepare("SELECT search_name, COALESCE(class_name, '') AS c FROM qr_expected WHERE qr_event_id = ?")
        .all(eventId)
        .map((r) => `${r.search_name}|${r.c.toLowerCase()}`),
    );

    for (const row of rows) {
      const key = searchName(row.name);
      const dedupe = `${key}|${String(row.className || "").toLowerCase()}`;
      if (!key || existing.has(dedupe)) {
        duplicates++;
        continue;
      }
      existing.add(dedupe);
      db.prepare(
        `INSERT INTO qr_expected (id, qr_event_id, name, search_name, class_name, phone, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), eventId, row.name, key, row.className || null, row.phone || null, row.note || null, ts);
      added++;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { added, duplicates };
}

export function listExpected(eventId) {
  return plainAll(
    getDb()
      .prepare(
        `SELECT x.*, a.id AS attendance_id, r.token AS token
           FROM qr_expected x
           LEFT JOIN qr_attendance a ON a.expected_id = x.id
           LEFT JOIN qr_registrations r ON r.id = a.registration_id
          WHERE x.qr_event_id = ?
          ORDER BY COALESCE(x.class_name, ''), x.name`,
      )
      .all(eventId),
  );
}

export function clearExpected(eventId) {
  getDb()
    .prepare(
      `DELETE FROM qr_expected
        WHERE qr_event_id = ?
          AND id NOT IN (SELECT expected_id FROM qr_attendance WHERE expected_id IS NOT NULL)`,
    )
    .run(eventId);
}

/* The door's type-ahead.

   Deliberately NOT "return the whole list". The check-in link gets pasted into
   WhatsApp groups, and a page that renders every expected name to anyone who
   opens it publishes the list — with the children's classes attached. Two
   characters is nothing for someone who knows their own name and a lot of work
   for someone enumerating.

   Anyone already marked present is excluded: offering a name that cannot be
   picked invites a queue of "it says I'm already here" at the worst moment. */
export function searchExpected(eventId, query, limit = 8) {
  const term = searchName(query);
  if (term.length < 2) return [];
  return plainAll(
    getDb()
      .prepare(
        `SELECT x.id, x.name, x.class_name
           FROM qr_expected x
           LEFT JOIN qr_attendance a ON a.expected_id = x.id
          WHERE x.qr_event_id = ? AND a.id IS NULL AND x.search_name LIKE ?
          ORDER BY CASE WHEN x.search_name LIKE ? THEN 0 ELSE 1 END, x.name
          LIMIT ?`,
      )
      .all(eventId, `%${term}%`, `${term}%`, limit),
  );
}

/* ---- checking in -------------------------------------------------------- */

/**
 * Register one party and log everyone in it as present.
 *
 * `people` is the whole party: the students matched off the expected list
 * (carrying expectedId) and the family members added on the day (without one).
 */
export function checkIn(eventId, input) {
  const db = getDb();
  const id = randomUUID();
  const token = uniqueToken(db);
  const ts = nowIso();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO qr_registrations (id, qr_event_id, token, family_name, contact_name, phone, email, answers_json, extra_pax, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      eventId,
      token,
      input.familyName,
      input.contactName || null,
      input.phone || null,
      input.email || null,
      JSON.stringify(input.answers || {}),
      clampPax(input.extraPax),
      ts,
    );

    (input.people || []).forEach((person, index) => {
      db.prepare(
        `INSERT INTO qr_attendance (id, qr_event_id, registration_id, expected_id, name, class_name, kind, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        eventId,
        id,
        person.expectedId || null,
        person.name,
        person.className || null,
        person.kind === "adult" ? "adult" : "child",
        index,
        ts,
      );
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    // UNIQUE(expected_id): two phones checked the same student in within a
    // second of each other. Reported rather than thrown so the door can say so.
    if (String(error?.message || "").includes("UNIQUE")) return { taken: true };
    throw error;
  }
  return { id, token };
}

export function getRegistrationByToken(token) {
  const db = getDb();
  const registration = plain(db.prepare("SELECT * FROM qr_registrations WHERE token = ?").get(token));
  if (!registration) return null;
  const event = getQrEvent(registration.qr_event_id);
  if (!event) return null;
  return { registration, event };
}

export function attendanceFor(registrationId) {
  return plainAll(
    getDb()
      .prepare("SELECT * FROM qr_attendance WHERE registration_id = ? ORDER BY position")
      .all(registrationId),
  );
}

export function listRegistrations(eventId) {
  const db = getDb();
  const rows = plainAll(
    db
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM qr_attendance a WHERE a.registration_id = r.id) AS named_count,
                (SELECT COUNT(*) FROM qr_attendance a WHERE a.registration_id = r.id) + r.extra_pax AS head_count,
                p.status AS photo_status
           FROM qr_registrations r
           LEFT JOIN qr_photos p ON p.registration_id = r.id
          WHERE r.qr_event_id = ?
          ORDER BY r.created_at DESC`,
      )
      .all(eventId),
  );
  return rows.map((row) => ({ ...row, answers: parseAnswers(row.answers_json) }));
}

/** Every person present, for the register and the CSV export. */
export function listAttendance(eventId) {
  return plainAll(
    getDb()
      .prepare(
        `SELECT a.*, r.family_name, r.contact_name, r.phone, r.email, r.answers_json, r.token, r.extra_pax
           FROM qr_attendance a
           JOIN qr_registrations r ON r.id = a.registration_id
          WHERE a.qr_event_id = ?
          ORDER BY COALESCE(a.class_name, ''), a.name`,
      )
      .all(eventId),
  );
}

export function qrStats(eventId) {
  const db = getDb();
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;

  const expected = one("SELECT COUNT(*) AS n FROM qr_expected WHERE qr_event_id = ?", eventId);
  const arrived = one(
    "SELECT COUNT(*) AS n FROM qr_attendance WHERE qr_event_id = ? AND expected_id IS NOT NULL",
    eventId,
  );
  const parties = one("SELECT COUNT(*) AS n FROM qr_registrations WHERE qr_event_id = ?", eventId);
  const named = one("SELECT COUNT(*) AS n FROM qr_attendance WHERE qr_event_id = ?", eventId);
  // Counted but not named. Reported separately as well as in the total, so the
  // per-class breakdown adding up to less than "people here" is explicable
  // rather than looking like a bug.
  const unnamed = one(
    "SELECT COALESCE(SUM(extra_pax), 0) AS n FROM qr_registrations WHERE qr_event_id = ?",
    eventId,
  );
  const people = named + unnamed;
  const adults = one(
    "SELECT COUNT(*) AS n FROM qr_attendance WHERE qr_event_id = ? AND kind = 'adult'",
    eventId,
  );
  const photos = one(
    "SELECT COUNT(*) AS n FROM qr_photos WHERE qr_event_id = ? AND status = 'ready'",
    eventId,
  );

  const perClass = plainAll(
    db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(class_name), ''), 'No class') AS class_name, COUNT(*) AS n
           FROM qr_attendance WHERE qr_event_id = ?
          GROUP BY 1 ORDER BY n DESC, 1`,
      )
      .all(eventId),
  );

  return {
    expected,
    arrived,
    awaited: Math.max(0, expected - arrived),
    parties,
    people,
    named,
    unnamed,
    adults,
    children: named - adults,
    photos,
    perClass,
  };
}

/* ---- the family photo --------------------------------------------------- */

export function getPhoto(registrationId) {
  return plain(getDb().prepare("SELECT * FROM qr_photos WHERE registration_id = ?").get(registrationId));
}

export function getPhotoByToken(token) {
  const db = getDb();
  return plain(
    db
      .prepare(
        `SELECT p.* FROM qr_photos p
           JOIN qr_registrations r ON r.id = p.registration_id
          WHERE r.token = ?`,
      )
      .get(token),
  );
}

/* Saved after a successful generation. Replaces any previous attempt for the
   same party — UNIQUE(registration_id) makes "one picture per family" a rule
   rather than a habit, and the old file is swept off the volume rather than
   left behind. */
export function savePhoto(eventId, registrationId, { fileName, mime, bytes, prompt, consentText }) {
  const db = getDb();
  const previous = getPhoto(registrationId);
  const ts = nowIso();

  db.prepare("DELETE FROM qr_photos WHERE registration_id = ?").run(registrationId);
  db.prepare(
    `INSERT INTO qr_photos (id, qr_event_id, registration_id, status, file_name, mime, bytes,
       prompt_used, consent_text, consent_at, created_at)
     VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), eventId, registrationId, fileName, mime, bytes, prompt, consentText, ts, ts);

  if (previous?.file_name && previous.file_name !== fileName) removePhoto(previous.file_name);
}

export function deletePhoto(registrationId) {
  const db = getDb();
  const photo = getPhoto(registrationId);
  if (!photo) return;
  db.prepare("DELETE FROM qr_photos WHERE registration_id = ?").run(registrationId);
  if (photo.file_name) removePhoto(photo.file_name);
}

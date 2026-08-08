import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { parseDesign, DEFAULT_DESIGN } from "./design.js";

// node:sqlite rows have a null prototype and can't cross the server/client
// boundary as-is, so every read here returns a plain object.

function nowIso() {
  return new Date().toISOString();
}

// URL-safe, human-readable, and collision-checked against the table.
export function makeSlug(title, db = getDb()) {
  const base =
    String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "invite";

  for (let attempt = 0; attempt < 50; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
    const clash = db.prepare("SELECT 1 FROM events WHERE slug = ?").get(slug);
    if (!clash) return slug;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function parseAgenda(json) {
  try {
    const rows = JSON.parse(json || "[]");
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => ({ time: String(r?.time || "").slice(0, 40), activity: String(r?.activity || "").slice(0, 160) }))
      .filter((r) => r.time || r.activity)
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function toEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    language: row.language || "en",
    title: row.title || "",
    tagline: row.tagline || "",
    body: row.body || "",
    startsAt: row.starts_at || "",
    endsAt: row.ends_at || "",
    venueName: row.venue_name || "",
    venueAddress: row.venue_address || "",
    mapUrl: row.map_url || "",
    directions: row.directions || "",
    parking: row.parking || "",
    dressCode: row.dress_code || "",
    bring: row.bring || "",
    agenda: parseAgenda(row.agenda),
    hostName: row.host_name || "",
    contactLine: row.contact_line || "",
    logoPath: row.logo_path || "",
    backgroundPath: row.background_path || "",
    design: parseDesign(row.design),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at || null,
  };
}

export function toRecipient(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    token: row.token,
    name: row.name || "",
    email: row.email || "",
    phone: row.phone || "",
    childName: row.child_name || "",
    emailStatus: row.email_status,
    emailError: row.email_error || null,
    whatsappStatus: row.whatsapp_status,
    whatsappError: row.whatsapp_error || null,
    rsvp: row.rsvp || null,
    rsvpAt: row.rsvp_at || null,
  };
}

// ── Events ─────────────────────────────────────────────────────────────────

export function listEvents() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM events ORDER BY created_at DESC").all();
  const counts = db
    .prepare(
      `SELECT event_id,
              COUNT(*) AS total,
              SUM(CASE WHEN rsvp = 'yes' THEN 1 ELSE 0 END) AS yes,
              SUM(CASE WHEN rsvp = 'no' THEN 1 ELSE 0 END) AS no
       FROM event_recipients GROUP BY event_id`
    )
    .all();
  const byEvent = new Map(counts.map((c) => [c.event_id, c]));

  return rows.map((row) => {
    const c = byEvent.get(row.id);
    return {
      ...toEvent(row),
      recipientCount: c?.total || 0,
      yesCount: c?.yes || 0,
      noCount: c?.no || 0,
    };
  });
}

export function getEvent(id) {
  return toEvent(getDb().prepare("SELECT * FROM events WHERE id = ?").get(id));
}

export function getEventBySlug(slug) {
  return toEvent(getDb().prepare("SELECT * FROM events WHERE slug = ?").get(slug));
}

export function createEvent({ title, createdBy }) {
  const db = getDb();
  const id = randomUUID();
  const now = nowIso();
  const clean = String(title || "").trim() || "Untitled event";

  db.prepare(
    `INSERT INTO events (id, slug, status, language, title, design, created_by, created_at, updated_at)
     VALUES (?, ?, 'draft', 'en', ?, ?, ?, ?, ?)`
  ).run(id, makeSlug(clean, db), clean, JSON.stringify(DEFAULT_DESIGN), createdBy, now, now);

  return getEvent(id);
}

// Columns the builder may write. Anything not listed is ignored, so a crafted
// form post can't reach status, slug or created_by.
const EDITABLE = {
  language: "language",
  title: "title",
  tagline: "tagline",
  body: "body",
  startsAt: "starts_at",
  endsAt: "ends_at",
  venueName: "venue_name",
  venueAddress: "venue_address",
  mapUrl: "map_url",
  directions: "directions",
  parking: "parking",
  dressCode: "dress_code",
  bring: "bring",
  hostName: "host_name",
  contactLine: "contact_line",
};

export function updateEvent(id, patch) {
  const db = getDb();
  const sets = [];
  const values = [];

  for (const [key, column] of Object.entries(EDITABLE)) {
    if (patch[key] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(String(patch[key] ?? "").slice(0, 4000));
  }
  if (patch.agenda !== undefined) {
    sets.push("agenda = ?");
    values.push(JSON.stringify(Array.isArray(patch.agenda) ? patch.agenda.slice(0, 30) : []));
  }
  if (patch.design !== undefined) {
    sets.push("design = ?");
    values.push(JSON.stringify(patch.design));
  }
  if (patch.logoPath !== undefined) {
    sets.push("logo_path = ?");
    values.push(patch.logoPath || null);
  }
  if (patch.backgroundPath !== undefined) {
    sets.push("background_path = ?");
    values.push(patch.backgroundPath || null);
  }

  if (!sets.length) return getEvent(id);
  sets.push("updated_at = ?");
  values.push(nowIso(), id);

  db.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return getEvent(id);
}

export function markEventSent(id) {
  const now = nowIso();
  getDb().prepare("UPDATE events SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
}

export function deleteEvent(id) {
  // Recipients cascade. Assets are removed by the caller, which knows the paths.
  getDb().prepare("DELETE FROM events WHERE id = ?").run(id);
}

// ── Contact lists ──────────────────────────────────────────────────────────

export function listContactLists() {
  const db = getDb();
  const lists = db.prepare("SELECT * FROM contact_lists ORDER BY updated_at DESC").all();
  const counts = db.prepare("SELECT list_id, COUNT(*) AS c FROM contacts GROUP BY list_id").all();
  const byList = new Map(counts.map((r) => [r.list_id, r.c]));
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    sourceName: l.source_name || "",
    count: byList.get(l.id) || 0,
    updatedAt: l.updated_at,
  }));
}

export function getContacts(listId) {
  return getDb()
    .prepare("SELECT id, name, email, phone, child_name FROM contacts WHERE list_id = ? ORDER BY rowid")
    .all(listId)
    .map((c) => ({
      id: c.id,
      name: c.name || "",
      email: c.email || "",
      phone: c.phone || "",
      childName: c.child_name || "",
    }));
}

export function createContactList({ name, sourceName, contacts, createdBy }) {
  const db = getDb();
  const id = randomUUID();
  const now = nowIso();

  db.prepare(
    "INSERT INTO contact_lists (id, name, source_name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, String(name || "Parent list").slice(0, 120), String(sourceName || "").slice(0, 200), createdBy, now, now);

  const insert = db.prepare(
    "INSERT INTO contacts (id, list_id, name, email, phone, child_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const c of contacts) {
    insert.run(randomUUID(), id, c.name || null, c.email || null, c.phone || null, c.childName || null, now);
  }
  return { id, count: contacts.length };
}

export function deleteContactList(id) {
  getDb().prepare("DELETE FROM contact_lists WHERE id = ?").run(id);
}

// ── Recipients ─────────────────────────────────────────────────────────────

export function listRecipients(eventId) {
  return getDb()
    .prepare("SELECT * FROM event_recipients WHERE event_id = ? ORDER BY rowid")
    .all(eventId)
    .map(toRecipient);
}

/**
 * Aggregate counts for one event.
 *
 * The send progress poll runs every couple of seconds while a job is in
 * flight; returning 1,000 recipient rows each time would push megabytes over
 * the wire for a progress bar. This is one row instead, and the full table is
 * only re-fetched when the send finishes or the admin asks for it.
 */
export function recipientCounts(eventId) {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN email    IS NOT NULL AND email    <> '' THEN 1 ELSE 0 END) AS emailable,
         SUM(CASE WHEN phone    IS NOT NULL AND phone    <> '' THEN 1 ELSE 0 END) AS whatsappable,
         SUM(CASE WHEN email_status    = 'sent'    THEN 1 ELSE 0 END) AS emailSent,
         SUM(CASE WHEN email_status    = 'failed'  THEN 1 ELSE 0 END) AS emailFailed,
         SUM(CASE WHEN email_status    = 'pending' THEN 1 ELSE 0 END) AS emailPending,
         SUM(CASE WHEN whatsapp_status = 'sent'    THEN 1 ELSE 0 END) AS waSent,
         SUM(CASE WHEN whatsapp_status = 'failed'  THEN 1 ELSE 0 END) AS waFailed,
         SUM(CASE WHEN whatsapp_status = 'pending' THEN 1 ELSE 0 END) AS waPending,
         SUM(CASE WHEN rsvp = 'yes' THEN 1 ELSE 0 END) AS yes,
         SUM(CASE WHEN rsvp = 'no'  THEN 1 ELSE 0 END) AS no
       FROM event_recipients WHERE event_id = ?`
    )
    .get(eventId);

  const counts = {};
  for (const [key, value] of Object.entries(row || {})) counts[key] = Number(value) || 0;
  counts.awaiting = counts.total - counts.yes - counts.no;
  return counts;
}

function pendingClause(channels) {
  const clauses = [];
  if (channels.email) clauses.push("email_status = 'pending'");
  if (channels.whatsapp) clauses.push("whatsapp_status = 'pending'");
  return clauses;
}

/**
 * The next parent still waiting on an enabled channel, or null.
 *
 * The send loop calls this once per parent, so it must not scan. Reading the
 * whole recipient list and filtering in JS — the obvious version — is O(n) per
 * parent and therefore O(n²) per send: at 1,000 parents that is a million row
 * objects built for nothing, and it dominated the send time until this
 * replaced it.
 */
export function nextPendingRecipient(eventId, channels) {
  const clauses = pendingClause(channels);
  if (!clauses.length) return null;

  const row = getDb()
    .prepare(
      `SELECT * FROM event_recipients
       WHERE event_id = ? AND (${clauses.join(" OR ")})
       ORDER BY rowid LIMIT 1`
    )
    .get(eventId);
  return toRecipient(row);
}

export function countPending(eventId, channels) {
  const clauses = pendingClause(channels);
  if (!clauses.length) return 0;

  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM event_recipients WHERE event_id = ? AND (${clauses.join(" OR ")})`)
    .get(eventId);
  return Number(row?.c) || 0;
}

export function getRecipientByToken(token) {
  return toRecipient(getDb().prepare("SELECT * FROM event_recipients WHERE token = ?").get(token));
}

/**
 * Snapshot a contact list onto an event, replacing any previous (unsent)
 * snapshot. Each recipient gets a 32-hex-character token: it is the only thing
 * standing between a guessed URL and someone else's RSVP, so it comes from
 * randomBytes, not from the row id.
 */
export function setRecipientsFromList(eventId, contacts) {
  const db = getDb();
  const now = nowIso();
  db.prepare("DELETE FROM event_recipients WHERE event_id = ?").run(eventId);

  const insert = db.prepare(
    `INSERT INTO event_recipients (id, event_id, token, name, email, phone, child_name, email_status, whatsapp_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of contacts) {
    insert.run(
      randomUUID(),
      eventId,
      randomBytes(16).toString("hex"),
      c.name || null,
      c.email || null,
      c.phone || null,
      c.childName || null,
      c.email ? "pending" : "skipped",
      c.phone ? "pending" : "skipped",
      now
    );
  }
  return listRecipients(eventId);
}

export function markDelivery(recipientId, channel, status, error) {
  const column = channel === "whatsapp" ? "whatsapp_status" : "email_status";
  const errorColumn = channel === "whatsapp" ? "whatsapp_error" : "email_error";
  getDb()
    .prepare(`UPDATE event_recipients SET ${column} = ?, ${errorColumn} = ? WHERE id = ?`)
    .run(status, error ? String(error).slice(0, 500) : null, recipientId);
}

export function recordRsvp(token, answer) {
  const db = getDb();
  const row = db.prepare("SELECT id FROM event_recipients WHERE token = ?").get(token);
  if (!row) return null;
  db.prepare("UPDATE event_recipients SET rsvp = ?, rsvp_at = ? WHERE id = ?").run(answer, nowIso(), row.id);
  return getRecipientByToken(token);
}

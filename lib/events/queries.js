import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { sanitizeTheme } from "./theme";
import { DEFAULT_LANG, isLang } from "./i18n";

/* 128 bits of entropy, hex. The invite URL is the guest's only credential, so
   this must be unguessable at the scale of a whole guest list — a short code
   would be enumerable by anyone who received one link. */
export function newToken() {
  return randomBytes(16).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

/* node:sqlite hands back rows with a NULL PROTOTYPE. React refuses to serialise
   those across the server→client boundary ("Only plain objects… can be passed
   to Client Components"), and the failure only shows up at runtime on the one
   page that forwards a row to a client component — never at build time.
   Everything leaving this module goes through here. */
function plain(row) {
  return row ? { ...row } : row;
}

function plainAll(rows) {
  return rows.map((r) => ({ ...r }));
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "event";
}

/* Singapore-first E.164 normalisation. Wati rejects anything that isn't E.164,
   and a silently-malformed number fails at send time — after Karim thinks the
   list is clean — so numbers are normalised at import and stored canonical.
   Returns null for anything unusable rather than guessing. */
export function normalizePhone(input, defaultCountry = "65") {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Bare 8-digit SG mobile/landline
  if (digits.length === 8 && /^[3689]/.test(digits)) digits = defaultCountry + digits;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/* ---- events ------------------------------------------------------------- */

export function createEvent({ title, hostName, startsAt, venueName, createdBy }) {
  const db = getDb();
  const id = randomUUID();
  const ts = nowIso();
  let slug = slugify(title);
  // Slugs are unique; suffix rather than fail so a repeat "Open House" works.
  const taken = db.prepare("SELECT 1 FROM events WHERE slug = ?");
  let n = 1;
  while (taken.get(slug)) slug = `${slugify(title)}-${++n}`;

  db.prepare(
    `INSERT INTO events (id, slug, title, host_name, starts_at, venue_name,
       support_url, theme_json, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    slug,
    title,
    hostName || null,
    startsAt || null,
    venueName || null,
    process.env.LQK_EVENT_SUPPORT_URL || null,
    JSON.stringify(sanitizeTheme(null)),
    createdBy || null,
    ts,
    ts
  );
  return getEvent(id);
}

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    ask_photo: !!row.ask_photo,
    ask_dietary: !!row.ask_dietary,
    theme: sanitizeTheme(row.theme_json),
    themeDraft: row.theme_draft_json ? sanitizeTheme(row.theme_draft_json) : null,
  };
}

export function getEvent(id) {
  return hydrate(getDb().prepare("SELECT * FROM events WHERE id = ?").get(id));
}

export function listEvents() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.*,
         (SELECT COUNT(*) FROM event_guests g WHERE g.event_id = e.id) AS guest_count,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id) AS reply_count,
         (SELECT COALESCE(SUM(r.adults + r.children), 0) FROM event_rsvps r
            WHERE r.event_id = e.id AND r.attending = 'yes') AS head_count
       FROM events e
       ORDER BY COALESCE(e.starts_at, e.created_at) DESC`
    )
    .all();
  return rows.map(hydrate);
}

const EVENT_FIELDS = [
  "title", "host_name", "starts_at", "ends_at", "venue_name", "venue_address",
  "venue_map_url", "dress_code", "rsvp_deadline", "support_url", "ask_photo",
  "ask_dietary", "max_party_size", "status",
];

export function updateEvent(id, patch) {
  const db = getDb();
  const sets = [];
  const values = [];
  for (const key of EVENT_FIELDS) {
    if (key in patch) {
      sets.push(`${key} = ?`);
      const v = patch[key];
      values.push(typeof v === "boolean" ? (v ? 1 : 0) : v ?? null);
    }
  }
  if (patch.theme !== undefined) {
    sets.push("theme_json = ?");
    values.push(JSON.stringify(sanitizeTheme(patch.theme)));
  }
  if (patch.themeDraft !== undefined) {
    sets.push("theme_draft_json = ?");
    values.push(patch.themeDraft ? JSON.stringify(sanitizeTheme(patch.themeDraft)) : null);
  }
  if (!sets.length) return getEvent(id);
  sets.push("updated_at = ?");
  values.push(nowIso(), id);
  db.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return getEvent(id);
}

/* Approving a draft promotes it and clears the draft — the explicit gate Karim
   asked for between "generate a look" and "this is what guests receive". */
export function approveThemeDraft(id) {
  const event = getEvent(id);
  if (!event?.themeDraft) return event;
  return updateEvent(id, { theme: event.themeDraft, themeDraft: null });
}

/* ---- guests ------------------------------------------------------------- */

export function addGuests(eventId, guests) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO event_guests (id, event_id, token, name, family_name, email,
       phone, lang, invited_party_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const ts = nowIso();
  const added = [];
  for (const g of guests) {
    const name = String(g.name || "").trim();
    if (!name) continue;
    const id = randomUUID();
    stmt.run(
      id,
      eventId,
      newToken(),
      name,
      (g.familyName || "").trim() || null,
      (g.email || "").trim().toLowerCase() || null,
      normalizePhone(g.phone),
      isLang(g.lang) ? g.lang : DEFAULT_LANG,
      Number(g.partySize) > 0 ? Math.min(20, Number(g.partySize)) : 2,
      ts
    );
    added.push(id);
  }
  return added;
}

export function listGuests(eventId) {
  return plainAll(
    getDb()
      .prepare(
      `SELECT g.*, r.attending, r.adults, r.children, r.dietary, r.message,
              r.photo_drive_id, r.checked_in_at, r.updated_at AS replied_at
         FROM event_guests g
         LEFT JOIN event_rsvps r ON r.guest_id = g.id
        WHERE g.event_id = ?
        ORDER BY g.name`
      )
      .all(eventId)
  );
}

export function getGuestByToken(token) {
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return null;
  const db = getDb();
  const guest = db.prepare("SELECT * FROM event_guests WHERE token = ?").get(token);
  if (!guest) return null;
  const event = getEvent(guest.event_id);
  if (!event) return null;
  const rsvp = db.prepare("SELECT * FROM event_rsvps WHERE guest_id = ?").get(guest.id) || null;
  return { guest: plain(guest), event, rsvp: plain(rsvp) };
}

/* First open is the only signal we get that a link actually reached someone —
   it drives the reminder cascade's "sent but never looked" bucket. Written
   once; later opens are not tracked (no behavioural profiling of guests). */
export function markOpened(guestId) {
  getDb()
    .prepare("UPDATE event_guests SET opened_at = ? WHERE id = ? AND opened_at IS NULL")
    .run(nowIso(), guestId);
}

/* ---- rsvps -------------------------------------------------------------- */

export function saveRsvp(guestId, eventId, data) {
  const db = getDb();
  const ts = nowIso();
  const existing = db.prepare("SELECT guest_id FROM event_rsvps WHERE guest_id = ?").get(guestId);
  const row = {
    attending: ["yes", "no", "maybe"].includes(data.attending) ? data.attending : "maybe",
    adults: Math.max(0, Math.min(20, Number(data.adults) || 0)),
    children: Math.max(0, Math.min(20, Number(data.children) || 0)),
    extra_names: (data.extraNames || "").slice(0, 2000) || null,
    dietary: (data.dietary || "").slice(0, 1000) || null,
    message: (data.message || "").slice(0, 2000) || null,
    photo_consent: data.photoConsent ? 1 : 0,
  };
  if (existing) {
    db.prepare(
      `UPDATE event_rsvps SET attending = ?, adults = ?, children = ?, extra_names = ?,
         dietary = ?, message = ?, photo_consent = ?, updated_at = ?
       WHERE guest_id = ?`
    ).run(
      row.attending, row.adults, row.children, row.extra_names,
      row.dietary, row.message, row.photo_consent, ts, guestId
    );
  } else {
    db.prepare(
      `INSERT INTO event_rsvps (guest_id, event_id, attending, adults, children,
         extra_names, dietary, message, photo_consent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      guestId, eventId, row.attending, row.adults, row.children,
      row.extra_names, row.dietary, row.message, row.photo_consent, ts, ts
    );
  }
  return db.prepare("SELECT * FROM event_rsvps WHERE guest_id = ?").get(guestId);
}

/* Kept separate from saveRsvp so a Drive upload that fails (or is retried)
   never rolls back an RSVP the guest already submitted. */
export function attachPhoto(guestId, driveFileId) {
  getDb()
    .prepare("UPDATE event_rsvps SET photo_drive_id = ?, updated_at = ? WHERE guest_id = ?")
    .run(driveFileId, nowIso(), guestId);
}

export function eventStats(eventId) {
  const db = getDb();
  const base = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM event_guests WHERE event_id = ?) AS invited,
         (SELECT COUNT(*) FROM event_rsvps  WHERE event_id = ? AND attending = 'yes')   AS yes,
         (SELECT COUNT(*) FROM event_rsvps  WHERE event_id = ? AND attending = 'no')    AS no,
         (SELECT COUNT(*) FROM event_rsvps  WHERE event_id = ? AND attending = 'maybe') AS maybe,
         (SELECT COALESCE(SUM(adults), 0)   FROM event_rsvps WHERE event_id = ? AND attending = 'yes') AS adults,
         (SELECT COALESCE(SUM(children), 0) FROM event_rsvps WHERE event_id = ? AND attending = 'yes') AS children,
         (SELECT COUNT(*) FROM event_rsvps  WHERE event_id = ? AND photo_drive_id IS NOT NULL) AS photos,
         (SELECT COUNT(*) FROM event_guests WHERE event_id = ? AND opened_at IS NOT NULL) AS opened`
    )
    .get(eventId, eventId, eventId, eventId, eventId, eventId, eventId, eventId);
  return {
    ...base,
    replied: base.yes + base.no + base.maybe,
    pending: base.invited - (base.yes + base.no + base.maybe),
    headcount: base.adults + base.children,
  };
}

/* Guests who were sent an invite, haven't replied, and haven't been nudged in
   the last 72h. The cascade calls this rather than re-deriving the rule. */
export function guestsNeedingReminder(eventId, cooldownHours = 72) {
  const cutoff = new Date(Date.now() - cooldownHours * 3600 * 1000).toISOString();
  return getDb()
    .prepare(
      `SELECT g.* FROM event_guests g
         LEFT JOIN event_rsvps r ON r.guest_id = g.id
        WHERE g.event_id = ?
          AND r.guest_id IS NULL
          AND (g.sent_email_at IS NOT NULL OR g.sent_wa_at IS NOT NULL)
          AND (g.last_reminder_at IS NULL OR g.last_reminder_at < ?)
        ORDER BY g.name`
    )
    .all(eventId, cutoff);
}

export function markSent(guestId, channel) {
  const col = channel === "wa" ? "sent_wa_at" : "sent_email_at";
  getDb().prepare(`UPDATE event_guests SET ${col} = ? WHERE id = ?`).run(nowIso(), guestId);
}

export function markReminded(guestId) {
  getDb()
    .prepare(
      "UPDATE event_guests SET reminder_count = reminder_count + 1, last_reminder_at = ? WHERE id = ?"
    )
    .run(nowIso(), guestId);
}

/* Caterer export. Deliberately only the attending list with headcount and
   dietary — not phone numbers or messages, which the caterer has no need for. */
export function cateringCsv(eventId) {
  const rows = getDb()
    .prepare(
      `SELECT g.name, g.family_name, r.adults, r.children, r.dietary, r.extra_names
         FROM event_rsvps r JOIN event_guests g ON g.id = r.guest_id
        WHERE r.event_id = ? AND r.attending = 'yes'
        ORDER BY g.name`
    )
    .all(eventId);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Guest", "Family", "Adults", "Children", "Total", "Dietary", "Party names"];
  const body = rows.map((r) =>
    [r.name, r.family_name, r.adults, r.children, r.adults + r.children, r.dietary, r.extra_names]
      .map(esc)
      .join(",")
  );
  return [head.map(esc).join(","), ...body].join("\r\n");
}

import "server-only";
import { randomUUID, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { sanitizeTheme } from "./theme";
import { sanitizeFields, answerText, parseAnswers } from "./fields";
import { MAX_PARTY_SIZE_LIMIT } from "./presets";
import { DEFAULT_LANG, isLang } from "./i18n";
import { normalizePhone } from "./phone";
import { endOfDeadlineDay } from "./when.js";

// Re-exported so the guest importer and the admin actions keep their existing
// import site; the implementation moved to a client-safe module because the
// custom-field validator needs it on both sides of the wire.
export { normalizePhone };

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
    ask_dietary: !!row.ask_dietary,
    // A product link with the switch off is a saved draft, not a live ask —
    // createEvent pre-fills LQK_EVENT_SUPPORT_URL so turning the contribution
    // on is one click, and nothing reaches guests until it is.
    ask_contribution: !!row.ask_contribution && !!(row.support_url || "").trim(),
    theme: sanitizeTheme(row.theme_json),
    themeDraft: row.theme_draft_json ? sanitizeTheme(row.theme_draft_json) : null,
    customFields: sanitizeFields(row.custom_fields_json),
  };
}

export function getEvent(id) {
  return hydrate(getDb().prepare("SELECT * FROM events WHERE id = ?").get(id));
}

/* Legacy 'maybe' rows count as NOT replied everywhere — the reply became a
   two-option choice in Aug 2026 and a "maybe" answers nothing the caterer or
   the reminder cascade can use. The rows themselves are kept (real guest data
   is never deleted by a migration); those families are simply reminder-eligible
   again. */
export function listEvents() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.*,
         (SELECT COUNT(*) FROM event_guests g WHERE g.event_id = e.id) AS guest_count,
         (SELECT COUNT(*) FROM event_rsvps r
            WHERE r.event_id = e.id AND r.attending IN ('yes','no')) AS reply_count,
         (SELECT COUNT(*) FROM event_rsvps r
            WHERE r.event_id = e.id AND r.attending = 'yes') AS yes_count,
         (SELECT COUNT(*) FROM event_rsvps r
            WHERE r.event_id = e.id AND r.attending = 'no') AS no_count,
         (SELECT COUNT(*) FROM event_rsvps r
            WHERE r.event_id = e.id AND r.attending = 'yes'
              AND r.contribution_status = 'paid') AS paid_count,
         (SELECT COALESCE(SUM(r.adults + r.children), 0) FROM event_rsvps r
            WHERE r.event_id = e.id AND r.attending = 'yes') AS head_count
       FROM events e
       ORDER BY COALESCE(e.starts_at, e.created_at) DESC`
    )
    .all();
  return rows.map(hydrate);
}

/* One rule for "no more replies", shared by the guest page, the guest actions
   and the webhook. End of the deadline day in Singapore, not midnight UTC. */
export function isEventClosed(event) {
  if (!event) return true;
  if (event.status === "closed") return true;
  const end = endOfDeadlineDay(event.rsvp_deadline);
  if (!end) return false;
  return Date.now() > end.getTime();
}

const EVENT_FIELDS = [
  "title", "host_name", "body_text", "starts_at", "ends_at", "venue_name", "venue_address",
  "venue_map_url", "dress_code", "rsvp_deadline", "support_url",
  "ask_dietary", "ask_contribution", "max_party_size", "registration_url", "status",
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
  // Sanitised on the way IN as well as out, so a definition that survives a
  // save is one the guest form can definitely render.
  if (patch.customFields !== undefined) {
    const clean = sanitizeFields(patch.customFields);
    sets.push("custom_fields_json = ?");
    values.push(clean.length ? JSON.stringify(clean) : null);
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
      `SELECT g.*, r.attending, r.adults, r.children, r.message,
              r.decline_reason, r.decline_reason_note,
              r.contribution_status, r.contribution_title, r.contribution_qty,
              r.contribution_amount, r.contribution_paid_at, r.shopify_order_id,
              r.checked_in_at, r.custom_json, r.attendees_json,
              r.updated_at AS replied_at
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
  const row = plain(rsvp);
  if (row) {
    // Parsed here so the form can prefill a returning guest's answers without
    // every caller re-implementing "what if this JSON is junk".
    row.custom = parseAnswers(row.custom_json, {});
    row.attendees = parseAnswers(row.attendees_json, []);
  }
  return { guest: plain(guest), event, rsvp: row };
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

/* Saves the reply itself. NEVER touches the contribution columns — a guest
   editing their party size must not wipe a payment the webhook already
   recorded. Those columns move only through markContributionPending and
   applyContributionPayment below. */
export function saveRsvp(guestId, eventId, data) {
  const db = getDb();
  const ts = nowIso();
  const existing = db.prepare("SELECT guest_id FROM event_rsvps WHERE guest_id = ?").get(guestId);
  const attending = data.attending === "no" ? "no" : "yes";
  // The per-event cap is enforced by validateReply before anything reaches
  // here; this is only the absolute backstop, and it has to sit above the
  // largest party size the editor allows (5000) or a big majlis would be
  // silently truncated on write.
  const headCap = MAX_PARTY_SIZE_LIMIT;
  const row = {
    attending,
    adults: attending === "yes" ? Math.max(0, Math.min(headCap, Number(data.adults) || 0)) : 0,
    children: attending === "yes" ? Math.max(0, Math.min(headCap, Number(data.children) || 0)) : 0,
    extra_names: attending === "yes" ? (data.extraNames || "").slice(0, 2000) || null : null,
    decline_reason: attending === "no" ? (data.declineReason || "").slice(0, 40) || null : null,
    decline_reason_note:
      attending === "no" ? (data.declineReasonNote || "").slice(0, 500) || null : null,
    message: (data.message || "").slice(0, 2000) || null,
    // Already coerced by validateAnswers; stored as JSON because the shape is
    // the event's to define. NULL rather than "{}" so an event with no custom
    // questions leaves no trace on the row.
    custom_json:
      data.custom && Object.keys(data.custom).length ? JSON.stringify(data.custom) : null,
    attendees_json:
      attending === "yes" && Array.isArray(data.attendees) && data.attendees.length
        ? JSON.stringify(data.attendees)
        : null,
  };
  if (existing) {
    db.prepare(
      `UPDATE event_rsvps SET attending = ?, adults = ?, children = ?, extra_names = ?,
         decline_reason = ?, decline_reason_note = ?, message = ?,
         custom_json = ?, attendees_json = ?, updated_at = ?
       WHERE guest_id = ?`
    ).run(
      row.attending, row.adults, row.children, row.extra_names,
      row.decline_reason, row.decline_reason_note, row.message,
      row.custom_json, row.attendees_json, ts, guestId
    );
  } else {
    db.prepare(
      `INSERT INTO event_rsvps (guest_id, event_id, attending, adults, children,
         extra_names, decline_reason, decline_reason_note, message,
         custom_json, attendees_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      guestId, eventId, row.attending, row.adults, row.children, row.extra_names,
      row.decline_reason, row.decline_reason_note, row.message,
      row.custom_json, row.attendees_json, ts, ts
    );
  }
  return plain(db.prepare("SELECT * FROM event_rsvps WHERE guest_id = ?").get(guestId));
}

/* ---- contributions ------------------------------------------------------ */

/* Stamped when the guest is sent to the store's checkout. Never downgrades
   'paid' — a guest can reopen checkout after paying (double-click, back
   button) and must not lose their confirmed state. */
export function markContributionPending(guestId, title, variantId) {
  getDb()
    .prepare(
      `UPDATE event_rsvps
          SET contribution_status = 'pending',
              contribution_title = COALESCE(?, contribution_title),
              contribution_variant_id = COALESCE(?, contribution_variant_id),
              updated_at = ?
        WHERE guest_id = ? AND contribution_status != 'paid'`
    )
    .run(title || null, variantId ? String(variantId) : null, nowIso(), guestId);
}

/* Called by the orders/paid webhook. Finds the guest from the 8-char token
   prefix + event id that travelled through checkout as cart attributes.

   Handles the purchase-first path too: if the family paid before ever pressing
   "Send my reply" (webhook raced them, or they finished checkout days later),
   a minimal attending-yes row is created so the payment is never orphaned —
   party sizes stay 0 until they come back through the link and update their
   reply, which the admin table makes visible.

   Idempotent by order id via the kv table: Shopify redelivers webhooks on
   timeouts, and a redelivery must not double-write. */
export function applyContributionPayment({
  eventId,
  tokenPrefix,
  orderId,
  lineTitle,
  qty,
  amount,
  paidAt,
}) {
  const db = getDb();
  const key = `shopevt:${orderId}`;
  if (db.prepare("SELECT 1 FROM kv WHERE key = ?").get(key)) return { ok: true, duplicate: true };

  const matches = db
    .prepare("SELECT * FROM event_guests WHERE event_id = ? AND token LIKE ?")
    .all(eventId, `${tokenPrefix}%`);
  // 8 hex chars = 32 bits; two guests of one event sharing a prefix is a
  // ~1-in-4-billion event, but if it ever happens we must not guess who paid.
  if (matches.length !== 1) {
    return { ok: false, error: matches.length ? "ambiguous token prefix" : "no matching guest" };
  }
  const guest = matches[0];

  const ts = nowIso();
  const existing = db
    .prepare("SELECT guest_id FROM event_rsvps WHERE guest_id = ?")
    .get(guest.id);
  if (!existing) {
    db.prepare(
      `INSERT INTO event_rsvps (guest_id, event_id, attending, adults, children,
         created_at, updated_at)
       VALUES (?, ?, 'yes', 0, 0, ?, ?)`
    ).run(guest.id, eventId, ts, ts);
  }
  db.prepare(
    `UPDATE event_rsvps
        SET contribution_status = 'paid',
            shopify_order_id = ?,
            contribution_title = ?,
            contribution_qty = ?,
            contribution_amount = ?,
            contribution_paid_at = ?,
            updated_at = ?
      WHERE guest_id = ?`
  ).run(
    String(orderId),
    (lineTitle || "").slice(0, 300) || null,
    Math.max(1, Number(qty) || 1),
    (amount || "").slice(0, 40) || null,
    paidAt || ts,
    ts,
    guest.id
  );
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)").run(key, ts);
  return { ok: true, guestId: guest.id };
}

/* ---- store registrations -------------------------------------------------

   Ticketed products (LQK Maulid 2026) sell straight from the store's product
   page, which captures name/email/phone per place as line item properties
   (docs/shopify/lqk-attendee-fields.liquid). Those orders never came through
   an invitation, so they get their own table instead of an RSVP row. The
   webhook route parses the payload (shopify-core.orderAttendees /
   storeOrderRecord); this module only stores and reads. */

/* Idempotent by order id — Shopify redelivers webhooks, and the first
   delivery's snapshot is as true as any retry's. */
export function recordStoreOrder(record, { eventId = null, guestId = null } = {}) {
  if (!record?.orderId) return { ok: false, error: "no order id" };
  const done = getDb()
    .prepare(
      `INSERT OR IGNORE INTO store_orders (order_id, order_number, line_title, qty,
         amount, currency, customer_name, customer_email, attendees_json,
         event_id, guest_id, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.orderId,
      record.orderNumber || null,
      record.lineTitle,
      record.qty,
      record.amount,
      record.currency,
      record.customerName,
      record.customerEmail,
      JSON.stringify(record.attendees || []),
      eventId,
      guestId,
      record.paidAt,
      nowIso()
    );
  return { ok: true, duplicate: done.changes === 0 };
}

export function listStoreOrders() {
  const rows = getDb()
    .prepare(
      `SELECT o.*, e.title AS event_title
         FROM store_orders o LEFT JOIN events e ON e.id = o.event_id
        ORDER BY o.paid_at DESC, o.created_at DESC`
    )
    .all();
  return plainAll(rows).map((row) => ({
    ...row,
    attendees: parseAnswers(row.attendees_json, []),
  }));
}

export function countStoreOrders() {
  return getDb().prepare("SELECT COUNT(*) AS n FROM store_orders").get().n;
}

/* One row per PERSON — the sheet the registration desk wants. The buyer's own
   details stay on every row so a walk-in with only the buyer's name can still
   be found. */
export function storeAttendeeCsv() {
  const head = ["#", "Order", "Item", "Paid", "Attendee", "Name", "Email", "Phone", "Booked by", "Booker email"];
  const body = [];
  let n = 0;
  for (const order of listStoreOrders()) {
    const attendees = order.attendees.length ? order.attendees : [{}];
    attendees.forEach((a, i) => {
      n += 1;
      body.push(
        [
          n,
          order.order_number ? `#${order.order_number}` : order.order_id,
          order.line_title,
          order.paid_at ? order.paid_at.slice(0, 10) : "",
          a.main || i === 0 ? "Main" : `Attendee ${i + 1}`,
          a.name,
          a.email,
          a.phone,
          order.customer_name,
          order.customer_email,
        ]
          .map(csvEsc)
          .join(",")
      );
    });
  }
  return [head.map(csvEsc).join(","), ...body].join("\r\n");
}

/* Kept separate from saveRsvp so a Drive upload that fails (or is retried)
   never rolls back an RSVP the guest already submitted. */
export function eventStats(eventId) {
  const db = getDb();
  const base = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM event_guests WHERE event_id = ?) AS invited,
         (SELECT COUNT(*) FROM event_rsvps  WHERE event_id = ? AND attending = 'yes')   AS yes,
         (SELECT COUNT(*) FROM event_rsvps  WHERE event_id = ? AND attending = 'no')    AS no,
         (SELECT COALESCE(SUM(adults), 0)   FROM event_rsvps WHERE event_id = ? AND attending = 'yes') AS adults,
         (SELECT COALESCE(SUM(children), 0) FROM event_rsvps WHERE event_id = ? AND attending = 'yes') AS children,
         (SELECT COUNT(*) FROM event_rsvps  WHERE event_id = ? AND attending = 'yes'
            AND contribution_status = 'paid') AS hampersPaid,
         (SELECT COUNT(*) FROM event_rsvps  WHERE event_id = ? AND attending = 'yes'
            AND contribution_status != 'paid') AS hampersUnpaid,
         (SELECT COUNT(*) FROM event_guests WHERE event_id = ? AND opened_at IS NOT NULL) AS opened`
    )
    .get(eventId, eventId, eventId, eventId, eventId, eventId, eventId, eventId);
  return {
    ...base,
    replied: base.yes + base.no,
    pending: base.invited - (base.yes + base.no),
    headcount: base.adults + base.children,
  };
}

/* Guests who were sent an invite, haven't replied, and haven't been nudged in
   the last 72h. The cascade calls this rather than re-deriving the rule.
   Legacy 'maybe' rows count as unreplied — those families still owe an answer. */
export function guestsNeedingReminder(eventId, cooldownHours = 72) {
  const cutoff = new Date(Date.now() - cooldownHours * 3600 * 1000).toISOString();
  return getDb()
    .prepare(
      `SELECT g.* FROM event_guests g
         LEFT JOIN event_rsvps r ON r.guest_id = g.id
        WHERE g.event_id = ?
          AND (r.guest_id IS NULL OR r.attending = 'maybe')
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

/* Guest-list export: every family that replied, with the reply, party,
   decline reason and contribution state — the columns the admin Replies table
   shows, in a form that survives being handed to a caterer or committee.
   Deliberately no phone numbers or emails; whoever needs contacts has the
   portal. Decline reasons are exported as their stored keys plus the free-text
   note — keys are stable, labels are translation-dependent. */
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function repliesWithAnswers(eventId) {
  return getDb()
    .prepare(
      `SELECT g.name, g.family_name, g.email, g.phone, r.attending, r.adults, r.children,
              r.decline_reason, r.decline_reason_note, r.message, r.extra_names,
              r.contribution_status, r.contribution_title, r.contribution_qty,
              r.contribution_amount, r.custom_json, r.attendees_json
         FROM event_rsvps r JOIN event_guests g ON g.id = r.guest_id
        WHERE r.event_id = ? AND r.attending IN ('yes','no')
        ORDER BY r.attending DESC, g.name`
    )
    .all(eventId);
}

/* One row per family. Custom questions become columns: a "once per family"
   question is its own column; a "for every person" question is flattened into
   one column holding every answer, because the alternative is a sheet whose
   width depends on the largest party. Use attendeeListCsv when the per-person
   answers are the point (a check-in desk). */
export function guestListCsv(eventId) {
  const event = getEvent(eventId);
  const fields = event?.customFields || [];
  const perFamily = fields.filter((f) => f.scope === "family");
  const perPerson = fields.filter((f) => f.scope === "attendee");
  const rows = repliesWithAnswers(eventId);

  const head = [
    "Guest", "Family", "Reply", "Adults", "Children", "Total",
    "Decline reason", "Note", "Message", "Party names",
    "Contribution", "Contribution item", "Qty", "Amount",
    ...perFamily.map((f) => f.label),
    ...perPerson.map((f) => `${f.label} (everyone)`),
  ];

  const body = rows.map((r) => {
    const custom = parseAnswers(r.custom_json, {});
    const attendees = parseAnswers(r.attendees_json, []);
    return [
      r.name,
      r.family_name,
      r.attending === "yes" ? "Coming" : "Can't come",
      r.attending === "yes" ? r.adults : "",
      r.attending === "yes" ? r.children : "",
      r.attending === "yes" ? r.adults + r.children : "",
      r.decline_reason,
      r.decline_reason_note,
      r.message,
      r.extra_names,
      // Blank, not "Unpaid", when the event never asked for a contribution —
      // a free event's export must not read like a list of debtors.
      !event?.ask_contribution || r.attending !== "yes"
        ? ""
        : r.contribution_status === "paid"
          ? "Paid"
          : "Unpaid",
      r.contribution_title,
      r.contribution_qty,
      r.contribution_amount,
      ...perFamily.map((f) => answerText(f, custom[f.id])),
      ...perPerson.map((f) =>
        attendees
          .map((entry, i) => {
            const text = answerText(f, entry?.[f.id]);
            return text ? `${i + 1}. ${text}` : "";
          })
          .filter(Boolean)
          .join(" | ")
      ),
    ]
      .map(csvEsc)
      .join(",");
  });

  return [head.map(csvEsc).join(","), ...body].join("\r\n");
}

/* One row per PERSON, for events that ask per-attendee questions — the sheet a
   registration desk actually wants. Families that answered nothing per-person
   still appear once, so nobody attending is missing from the list. */
export function attendeeListCsv(eventId) {
  const event = getEvent(eventId);
  const perPerson = (event?.customFields || []).filter((f) => f.scope === "attendee");
  const rows = repliesWithAnswers(eventId).filter((r) => r.attending === "yes");

  const head = ["#", "Family", "Invited contact", "Phone", "Person", ...perPerson.map((f) => f.label)];
  const body = [];
  let n = 0;

  for (const r of rows) {
    const attendees = parseAnswers(r.attendees_json, []);
    const heads = Math.max(1, (r.adults || 0) + (r.children || 0));
    for (let i = 0; i < heads; i += 1) {
      n += 1;
      const entry = attendees[i] || {};
      body.push(
        [
          n,
          r.family_name || r.name,
          r.email,
          r.phone,
          `${i + 1} of ${heads}${i < (r.adults || 0) ? " (adult)" : " (child)"}`,
          ...perPerson.map((f) => answerText(f, entry[f.id])),
        ]
          .map(csvEsc)
          .join(",")
      );
    }
  }

  return [head.map(csvEsc).join(","), ...body].join("\r\n");
}

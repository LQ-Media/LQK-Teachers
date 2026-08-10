/* Seed a demo event with three guests, one per language, and print their
   invitation links.
 *
 * Useful for checking the guest page end to end (including RTL) without
 * sending anything to a real person.
 *
 *   node --experimental-sqlite scripts/seed-demo-event.mjs
 *   LQK_DATA_DIR=/data node --experimental-sqlite scripts/seed-demo-event.mjs   # on Railway
 *
 * Uses raw SQL rather than lib/events/queries.js on purpose: that module imports
 * "server-only" and the "@/" path alias, neither of which resolves outside the
 * Next build. Keep the column lists here in step with ensureSchema in lib/db.js.
 */

import { randomUUID, randomBytes } from "node:crypto";
import { getDb } from "../lib/db.js";

const db = getDb();
const now = new Date().toISOString();
const token = () => randomBytes(16).toString("hex");

const eventId = randomUUID();
const slug = `demo-maulid-${Date.now().toString(36)}`;

db.prepare(
  `INSERT INTO events (id, slug, title, host_name, starts_at, ends_at, venue_name,
     venue_address, dress_code, rsvp_deadline, support_url, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`
).run(
  eventId,
  slug,
  "Maulid 2026",
  "Little Quran Kids",
  "2026-09-12T19:00",
  "2026-09-12T22:00",
  "Woods Square",
  "12 Woodlands Square, Singapore 737715",
  "Traditional / modest attire",
  "2026-09-01",
  process.env.LQK_EVENT_SUPPORT_URL ||
    "https://lqkstore.littlequrankids.sg/products/lqk-maulid-2026",
  now,
  now
);

const guests = [
  ["Ahmad Family", "Ahmad", "+6591234567", "ms", 4],
  ["Siti Rahman", "Rahman", "+6598765432", "en", 2],
  ["Yusuf Abdullah", "Abdullah", null, "ar", 3],
];

const insert = db.prepare(
  `INSERT INTO event_guests (id, event_id, token, name, family_name, email, phone,
     lang, invited_party_size, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

console.log(`\nEvent: ${eventId}  (/events/${eventId})\n`);
for (const [name, family, phone, lang, party] of guests) {
  const t = token();
  insert.run(
    randomUUID(),
    eventId,
    t,
    name,
    family,
    `${family.toLowerCase()}@example.com`,
    phone,
    lang,
    party,
    now
  );
  console.log(`  ${lang}  ${name.padEnd(16)}  /i/${t}`);
}
console.log("");

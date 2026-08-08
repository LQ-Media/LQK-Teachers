// Smoke test for the event invite sender.
//
// Part 1 exercises the pure modules directly (CSV parsing, phone
// normalisation, design sanitising, email rendering).
// Part 2 drives the real public invite page over HTTP against a running
// server, which is the path that has to work for a parent with no login.
//
// Run: node scripts/smoke-events.mjs   (with the dev server on $BASE)

import assert from "node:assert/strict";
import { parseCsv, guessMapping, looksLikeHeader, rowsToContacts, normalizePhone } from "../lib/events/csv.js";
import { normalizeDesign, DEFAULT_DESIGN, t } from "../lib/events/design.js";
import { formatWhen, formatWhenShort } from "../lib/events/format.js";
import { renderInviteEmail, renderInviteText, safeUrl, escapeHtml } from "../lib/events/email-html.js";

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

console.log("\nCSV parsing");

check("parses quoted fields, embedded commas and CRLF", () => {
  const rows = parseCsv('Name,Email,Mobile\r\n"Tan, Siti",siti@example.com,91234567\r\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ["Tan, Siti", "siti@example.com", "91234567"]);
});

check("strips a UTF-8 BOM from the first header", () => {
  const rows = parseCsv("﻿Name,Email\nA,a@b.com\n");
  assert.equal(rows[0][0], "Name");
});

check("handles doubled quotes and embedded newlines", () => {
  const rows = parseCsv('Note\n"He said ""hi""\nthen left"\n');
  assert.equal(rows[1][0], 'He said "hi"\nthen left');
});

check("detects a header row and maps aliased columns", () => {
  const rows = parseCsv("Parent Name,Email Address,Contact Number,Student\nA,a@b.com,91234567,Zayd\n");
  assert.equal(looksLikeHeader(rows[0]), true);
  const m = guessMapping(rows[0]);
  assert.equal(m.name, 0);
  assert.equal(m.email, 1);
  assert.equal(m.phone, 2);
  assert.equal(m.child_name, 3);
});

console.log("\nPhone normalisation");

check("adds +65 to a bare 8-digit Singapore mobile", () => {
  assert.equal(normalizePhone("9123 4567"), "6591234567");
  assert.equal(normalizePhone("81234567"), "6581234567");
});

check("keeps an already-international number", () => {
  assert.equal(normalizePhone("+65 9123 4567"), "6591234567");
  assert.equal(normalizePhone("0060123456789"), "60123456789");
  assert.equal(normalizePhone("6591234567"), "6591234567");
});

check("rejects a number too short to dial", () => {
  assert.equal(normalizePhone("1234"), "");
  assert.equal(normalizePhone("not a number"), "");
  assert.equal(normalizePhone(""), "");
});

console.log("\nContact extraction");

check("skips rows with no usable contact rather than dropping them silently", () => {
  const rows = parseCsv("Name,Email,Phone\nA,a@b.com,91234567\nB,not-an-email,\nC,,98765432\n");
  const { contacts, skipped } = rowsToContacts(rows, guessMapping(rows[0]), { hasHeader: true });
  assert.equal(contacts.length, 2);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /Email isn't valid/);
});

check("de-duplicates a parent repeated once per child", () => {
  const rows = parseCsv("Name,Email,Phone\nA,a@b.com,91234567\nA,a@b.com,91234567\n");
  const { contacts } = rowsToContacts(rows, guessMapping(rows[0]), { hasHeader: true });
  assert.equal(contacts.length, 1);
});

console.log("\nDesign sanitising");

check("rejects a non-hex colour and falls back to the default", () => {
  const d = normalizeDesign({ accentColor: "red; background:url(javascript:alert(1))" });
  assert.equal(d.accentColor, DEFAULT_DESIGN.accentColor);
});

check("clamps the overlay and rejects an unknown font", () => {
  assert.equal(normalizeDesign({ overlay: 999 }).overlay, 85);
  assert.equal(normalizeDesign({ overlay: -5 }).overlay, 0);
  assert.equal(normalizeDesign({ headingFont: "comic-sans" }).headingFont, DEFAULT_DESIGN.headingFont);
});

check("rejects an unknown alignment", () => {
  assert.equal(normalizeDesign({ align: "justify" }).align, DEFAULT_DESIGN.align);
});

console.log("\nURL and HTML safety");

check("refuses javascript: and data: URLs", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,<script>"), "");
  assert.equal(safeUrl("https://maps.app.goo.gl/abc"), "https://maps.app.goo.gl/abc");
});

check("escapes HTML in event text", () => {
  assert.equal(escapeHtml('<script>"x"'), "&lt;script&gt;&quot;x&quot;");
});

console.log("\nDates");

check("formats a Singapore wall-clock time without a UTC round-trip", () => {
  const when = formatWhen("2026-09-12T10:00", "2026-09-12T12:30", "en");
  assert.match(when, /Saturday/);
  assert.match(when, /12 September 2026/);
  assert.match(when, /10:00/);
  assert.match(when, /12:30/);
});

check("short form drops the weekday for WhatsApp", () => {
  const short = formatWhenShort("2026-09-12T10:00", "en");
  assert.match(short, /12 Sept? 2026/); // en-SG abbreviates September as "Sept"
  assert.ok(!short.includes("Saturday"), "the short form must not carry the weekday");
  assert.match(short, /10:00/);
});

console.log("\nEmail rendering");

const sampleEvent = {
  id: "e1",
  slug: "graduation-2026",
  status: "draft",
  language: "en",
  title: "Graduation Day 2026",
  tagline: "A morning with our huffaz",
  body: "Please join us.",
  startsAt: "2026-09-12T10:00",
  endsAt: "2026-09-12T12:30",
  venueName: "LQK Woods Square",
  venueAddress: "12 Woodlands Square",
  mapUrl: "https://maps.app.goo.gl/abc",
  directions: "Lift lobby B, level 5",
  parking: "Basement",
  dressCode: "Smart casual",
  bring: "Just yourselves",
  agenda: [{ time: "10:00", activity: "Arrival" }],
  hostName: "Little Quran Kids",
  contactLine: "Questions? WhatsApp 8123 4567",
  logoPath: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png",
  backgroundPath: "11111111-2222-3333-4444-555555555555.jpg",
  design: DEFAULT_DESIGN,
};

check("renders absolute asset URLs so images load in a mail client", () => {
  const html = renderInviteEmail(sampleEvent, {
    inviteUrl: "https://teachers.littlequrankids.sg/invite/graduation-2026?r=tok",
    assetBase: "https://teachers.littlequrankids.sg",
    recipientName: "Siti",
  });
  assert.match(html, /https:\/\/teachers\.littlequrankids\.sg\/api\/events\/asset\/aaaaaaaa/);
  assert.match(html, /https:\/\/teachers\.littlequrankids\.sg\/api\/events\/asset\/11111111/);
  assert.ok(!/src="\/api/.test(html), "no relative image src may survive into an email");
});

check("uses tables and inline styles, never flexbox or a style block", () => {
  const html = renderInviteEmail(sampleEvent, { inviteUrl: "https://x.test/i" });
  assert.match(html, /<table/);
  assert.ok(!/<style[\s>]/.test(html), "a <style> block would be stripped by Gmail");
  assert.ok(!/display:\s*flex/.test(html), "flexbox does not render in Outlook");
});

check("carries the greeting, the RSVP link and every detail field", () => {
  const html = renderInviteEmail(sampleEvent, { inviteUrl: "https://x.test/invite/g?r=tok", recipientName: "Siti" });
  for (const needle of ["Dear Siti", "Graduation Day 2026", "12 September 2026", "LQK Woods Square", "Smart casual", "Just yourselves", "Basement", "Arrival", "https://x.test/invite/g?r=tok"]) {
    assert.ok(html.includes(needle), `missing: ${needle}`);
  }
});

check("escapes a malicious event title instead of emitting it raw", () => {
  const html = renderInviteEmail({ ...sampleEvent, title: '<img src=x onerror=alert(1)>' }, { inviteUrl: "https://x.test/i" });
  assert.ok(!html.includes("<img src=x onerror"), "title must be escaped");
  assert.match(html, /&lt;img src=x onerror/);
});

check("renders Malay wording when the event language is ms", () => {
  const html = renderInviteEmail({ ...sampleEvent, language: "ms" }, { inviteUrl: "https://x.test/i" });
  assert.ok(html.includes(t("ms").youreInvited), "expected Malay heading");
  assert.match(html, /lang="ms"/);
});

check("produces a plain-text alternative", () => {
  const text = renderInviteText(sampleEvent, { inviteUrl: "https://x.test/i", recipientName: "Siti" });
  assert.match(text, /Graduation Day 2026/);
  assert.match(text, /https:\/\/x\.test\/i/);
  assert.ok(!text.includes("<"), "text part must not contain markup");
});

// ── Part 2: the live public page ──────────────────────────────────────────
const BASE = process.env.BASE;
if (BASE) {
  const { DatabaseSync } = await import("node:sqlite");
  const { randomUUID } = await import("node:crypto");
  const path = await import("node:path");

  console.log("\nLive public invite page");

  // Touch a page that opens the DB, so the schema exists before we write to it.
  await fetch(`${BASE}/invite/warmup`).catch(() => {});

  const dbPath = path.join(process.env.LQK_DATA_DIR, "lqk.db");
  const db = new DatabaseSync(dbPath);
  const now = new Date().toISOString();
  const eventId = randomUUID();
  const token = "a".repeat(32);
  const slug = `smoke-${Date.now().toString(36)}`;

  db.prepare(
    `INSERT INTO events (id, slug, status, language, title, tagline, body, starts_at, ends_at, venue_name, venue_address, map_url, directions, parking, dress_code, bring, agenda, host_name, contact_line, design, created_at, updated_at)
     VALUES (?, ?, 'draft', 'en', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId, slug, "Graduation Day 2026", "A morning with our huffaz", "Please join us.",
    "2026-09-12T10:00", "2026-09-12T12:30", "LQK Woods Square", "12 Woodlands Square",
    "https://maps.app.goo.gl/abc", "Lift lobby B", "Basement", "Smart casual", "Just yourselves",
    JSON.stringify([{ time: "10:00", activity: "Arrival" }]), "Little Quran Kids",
    "Questions? WhatsApp 8123 4567", JSON.stringify(DEFAULT_DESIGN), now, now
  );

  db.prepare(
    `INSERT INTO event_recipients (id, event_id, token, name, email, phone, email_status, whatsapp_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'sent', 'sent', ?)`
  ).run(randomUUID(), eventId, token, "Siti", "siti@example.com", "6591234567", now);
  db.close();

  const res = await fetch(`${BASE}/invite/${slug}?r=${token}`, { redirect: "manual" });
  const html = await res.text();

  check("serves the invite to a logged-out parent (no redirect to /login)", () => {
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  });

  check("renders the event details on the public page", () => {
    for (const needle of ["Graduation Day 2026", "12 September 2026", "LQK Woods Square", "Smart casual", "Arrival"]) {
      assert.ok(html.includes(needle), `missing on page: ${needle}`);
    }
  });

  check("shows the RSVP buttons for a valid token", () => {
    assert.ok(html.includes("Yes, I&#x27;ll be there") || html.includes("Yes, I'll be there"), "missing Attending button");
    assert.ok(html.includes("Sorry, I can") , "missing decline button");
  });

  const noToken = await fetch(`${BASE}/invite/${slug}`);
  const noTokenHtml = await noToken.text();
  check("hides the RSVP buttons when the link carries no token", () => {
    assert.equal(noToken.status, 200);
    assert.ok(noTokenHtml.includes("Graduation Day 2026"), "invite should still render");
    assert.ok(!noTokenHtml.includes("Yes, I&#x27;ll be there") && !noTokenHtml.includes("Yes, I'll be there"), "RSVP must not render without a token");
  });

  const unknown = await fetch(`${BASE}/invite/does-not-exist-at-all`);
  check("shows a friendly page for an unknown slug", async () => {
    assert.equal(unknown.status, 200);
  });

  const gated = await fetch(`${BASE}/events`, { redirect: "manual" });
  check("still gates the admin builder behind the login", () => {
    assert.ok([302, 307].includes(gated.status), `expected a redirect, got ${gated.status}`);
    assert.match(gated.headers.get("location") || "", /\/login/);
  });
} else {
  console.log("\n(Set BASE to also run the live-page checks.)");
}

console.log(failures ? `\n${failures} check(s) failed.\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);

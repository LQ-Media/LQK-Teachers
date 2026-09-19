// Password-reset tokens and linked social accounts, against a real SQLite
// database with the same schema the portal ships.
//
// Both tables guard the same thing from different sides: who is allowed to
// become a given teacher. A reset token that outlives its use, or a Google
// account that can be claimed by two profiles, each ends with one member of
// staff able to sign in as another — and this portal approves payroll.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import {
  RESET_MAX_PER_HOUR,
  RESET_TTL_MINUTES,
  createResetToken,
  findResetByToken,
  generateResetToken,
  hashResetToken,
  isResetUsable,
  markResetUsed,
  recentResetCount,
} from "../lib/auth/reset.js";

import { findIdentity, linkIdentity, listIdentities, touchIdentity, unlinkIdentity } from "../lib/auth/identities.js";

// The two tables under test, copied from ensureSchema in lib/db.js, plus just
// enough of `profiles` for the foreign keys to bite.
const SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
  );
  CREATE TABLE oauth_identities (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'apple', 'microsoft')),
    subject TEXT NOT NULL,
    email TEXT,
    linked_at TEXT NOT NULL,
    last_used_at TEXT,
    UNIQUE(provider, subject)
  );
  CREATE TABLE password_resets (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
`;

let db;
const AISYAH = "profile-aisyah";
const KARIM = "profile-karim";

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const insert = db.prepare("INSERT INTO profiles (id, full_name, email) VALUES (?, ?, ?)");
  insert.run(AISYAH, "Aisyah Binte Rahman", "aisyah@lqk.sg");
  insert.run(KARIM, "Karim", "karim@lqk.sg");
});

describe("reset tokens are stored as hashes, never as themselves", () => {
  test("the database never sees the token", () => {
    const token = createResetToken(db, AISYAH);
    const row = db.prepare("SELECT * FROM password_resets").get();
    assert.notEqual(row.token_hash, token);
    assert.equal(row.token_hash, hashResetToken(token));
    // A leaked backup has to be useless: the only copy of the token is in the
    // email that was sent.
    assert.equal(JSON.stringify(row).includes(token), false);
  });

  test("hashing is deterministic, and two tokens never collide", () => {
    assert.equal(hashResetToken("abc"), hashResetToken("abc"));
    assert.notEqual(generateResetToken(), generateResetToken());
  });

  test("a token finds its own row and nobody else's", () => {
    const mine = createResetToken(db, AISYAH);
    const theirs = createResetToken(db, KARIM);
    assert.equal(findResetByToken(db, mine).profile_id, AISYAH);
    assert.equal(findResetByToken(db, theirs).profile_id, KARIM);
    assert.equal(findResetByToken(db, "not-a-token"), null);
    assert.equal(findResetByToken(db, ""), null);
  });
});

describe("a reset link works once, and not forever", () => {
  test("a fresh, unused link is redeemable", () => {
    const token = createResetToken(db, AISYAH);
    assert.equal(isResetUsable(findResetByToken(db, token)), true);
  });

  test("redeeming it burns it", () => {
    const token = createResetToken(db, AISYAH);
    const row = findResetByToken(db, token);
    markResetUsed(db, row.id);
    assert.equal(isResetUsable(findResetByToken(db, token)), false);
  });

  test("it expires after the advertised hour", () => {
    const issuedAt = new Date("2026-09-07T10:00:00.000Z");
    const token = createResetToken(db, AISYAH, issuedAt);
    const row = findResetByToken(db, token);

    const justInside = new Date(issuedAt.getTime() + (RESET_TTL_MINUTES - 1) * 60_000);
    const justOutside = new Date(issuedAt.getTime() + (RESET_TTL_MINUTES + 1) * 60_000);
    assert.equal(isResetUsable(row, justInside), true);
    assert.equal(isResetUsable(row, justOutside), false);
  });

  test("nothing, or a corrupt expiry, is not redeemable", () => {
    assert.equal(isResetUsable(null), false);
    assert.equal(isResetUsable({ expires_at: "not a date" }), false);
  });

  test("asking again burns the earlier link", () => {
    // Three taps means three emails; the teacher will open whichever they see
    // first. Only the newest may work, or an old link left live in an inbox
    // stays a way into the account.
    const first = createResetToken(db, AISYAH);
    const second = createResetToken(db, AISYAH);
    assert.equal(isResetUsable(findResetByToken(db, first)), false);
    assert.equal(isResetUsable(findResetByToken(db, second)), true);
  });

  test("one teacher's request never touches another's link", () => {
    const hers = createResetToken(db, AISYAH);
    createResetToken(db, KARIM);
    assert.equal(isResetUsable(findResetByToken(db, hers)), true);
  });
});

describe("the reset endpoint can't be used to bomb an inbox", () => {
  test("requests inside the last hour are counted", () => {
    const now = new Date("2026-09-07T10:00:00.000Z");
    for (let i = 0; i < RESET_MAX_PER_HOUR; i++) createResetToken(db, AISYAH, now);
    assert.equal(recentResetCount(db, AISYAH, now), RESET_MAX_PER_HOUR);
    assert.equal(recentResetCount(db, KARIM, now), 0);
  });

  test("the window rolls forward, so the cap is never permanent", () => {
    const now = new Date("2026-09-07T10:00:00.000Z");
    for (let i = 0; i < RESET_MAX_PER_HOUR; i++) createResetToken(db, AISYAH, now);
    const anHourAndABitLater = new Date(now.getTime() + 61 * 60_000);
    assert.equal(recentResetCount(db, AISYAH, anHourAndABitLater), 0);
  });

  test("used rows still count, so burning links doesn't reset the cap", () => {
    const now = new Date("2026-09-07T10:00:00.000Z");
    createResetToken(db, AISYAH, now);
    createResetToken(db, AISYAH, now); // burns the first
    assert.equal(recentResetCount(db, AISYAH, now), 2);
  });
});

describe("a provider account belongs to exactly one profile", () => {
  const NOW = "2026-09-07T10:00:00.000Z";

  test("linking, then finding it again", () => {
    const result = linkIdentity(db, {
      profileId: AISYAH,
      provider: "google",
      subject: "google-sub-1",
      email: "aisyah@lqk.sg",
      whenIso: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal(findIdentity(db, "google", "google-sub-1").profile_id, AISYAH);
  });

  test("a second profile cannot claim the same Google account", () => {
    // Without this, two teachers sharing one Google account could each sign in
    // as the other — including into the other's work hours.
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "shared", whenIso: NOW });
    const stolen = linkIdentity(db, { profileId: KARIM, provider: "google", subject: "shared", whenIso: NOW });
    assert.deepEqual(stolen, { ok: false, reason: "claimed" });
    assert.equal(findIdentity(db, "google", "shared").profile_id, AISYAH);
  });

  test("listIdentities returns plain objects a Client Component can receive", () => {
    // node:sqlite rows have a null prototype and React refuses to serialise one
    // into a Client Component. The profile page hands this list straight to
    // ConnectedAccounts, and an unlinked profile — having no rows — hides the
    // problem completely, so it has to be pinned here.
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "g", email: "a@lqk.sg", whenIso: NOW });
    const [row] = listIdentities(db, AISYAH);
    assert.equal(Object.getPrototypeOf(row), Object.prototype);
    assert.deepEqual(row, { provider: "google", email: "a@lqk.sg", linkedAt: NOW, lastUsedAt: NOW });
  });

  test("re-linking the same account to the same profile just refreshes it", () => {
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "s1", email: "old@lqk.sg", whenIso: NOW });
    const again = linkIdentity(db, {
      profileId: AISYAH,
      provider: "google",
      subject: "s1",
      email: "new@lqk.sg",
      whenIso: "2026-09-08T10:00:00.000Z",
    });
    assert.equal(again.ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM oauth_identities").get().n, 1);
    assert.equal(findIdentity(db, "google", "s1").email, "new@lqk.sg");
  });

  test("connecting a different Google account replaces the old one", () => {
    // Otherwise "Disconnect Google" would be ambiguous about which one it means.
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "first", whenIso: NOW });
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "second", whenIso: NOW });
    assert.equal(findIdentity(db, "google", "first"), undefined);
    assert.equal(findIdentity(db, "google", "second").profile_id, AISYAH);
    assert.equal(listIdentities(db, AISYAH).length, 1);
  });

  test("the three providers coexist on one profile", () => {
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "g", whenIso: NOW });
    linkIdentity(db, { profileId: AISYAH, provider: "apple", subject: "a", whenIso: NOW });
    linkIdentity(db, { profileId: AISYAH, provider: "microsoft", subject: "m", whenIso: NOW });
    assert.deepEqual(
      listIdentities(db, AISYAH).map((r) => r.provider),
      ["apple", "google", "microsoft"]
    );
  });

  test("disconnecting removes only that provider, for only that profile", () => {
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "g1", whenIso: NOW });
    linkIdentity(db, { profileId: AISYAH, provider: "apple", subject: "a1", whenIso: NOW });
    linkIdentity(db, { profileId: KARIM, provider: "google", subject: "g2", whenIso: NOW });

    unlinkIdentity(db, AISYAH, "google");
    assert.deepEqual(listIdentities(db, AISYAH).map((r) => r.provider), ["apple"]);
    assert.equal(listIdentities(db, KARIM).length, 1);
  });

  test("signing in stamps last_used_at without disturbing the link", () => {
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "g", whenIso: NOW });
    touchIdentity(db, "google", "g", "2026-10-01T00:00:00.000Z");
    const row = findIdentity(db, "google", "g");
    assert.equal(row.last_used_at, "2026-10-01T00:00:00.000Z");
    assert.equal(row.linked_at, NOW);
  });

  test("deleting a profile takes its linked accounts with it", () => {
    linkIdentity(db, { profileId: AISYAH, provider: "google", subject: "g", whenIso: NOW });
    createResetToken(db, AISYAH);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(AISYAH);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM oauth_identities").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM password_resets").get().n, 0);
  });
});

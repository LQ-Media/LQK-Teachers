// QR Registration: pass tokens, the word/booth invariant, reward tiers, and the
// two constraints that decide what happens in the hall.
//
// The scanner and the prize counter are operated by tired volunteers on
// borrowed phones, so the rules worth pinning down are the ones that cost real
// money or real embarrassment when they slip: a booth awarded twice, a prize
// given twice, a prize given early, and one family's progress leaking into
// another's pass.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import {
  TOKEN_ALPHABET,
  TOKEN_LENGTH,
  isToken,
  parseToken,
  formatToken,
  wordLetters,
  wordFits,
  parseTiers,
  tierState,
  nextClaimable,
  displayName,
} from "../lib/qr/passport.js";

import { QR_SCHEMA_SQL } from "../lib/qr/schema.js";

describe("pass tokens", () => {
  test("the alphabet excludes every character a volunteer misreads aloud", () => {
    // I/L/1, O/0 and U/V are the pairs that get confused across a noisy hall.
    for (const banned of ["I", "L", "O", "U", "0", "1"]) {
      assert.equal(TOKEN_ALPHABET.includes(banned), false, `${banned} must not be in the alphabet`);
    }
    assert.equal(new Set(TOKEN_ALPHABET).size, TOKEN_ALPHABET.length, "no duplicates");
  });

  test("a well-formed token is 8 characters from that alphabet", () => {
    assert.equal(isToken("K7M2XQ9B"), true);
    assert.equal(isToken("K7M2XQ9"), false, "too short");
    assert.equal(isToken("K7M2XQ9BB"), false, "too long");
    assert.equal(isToken("K7M2XQ9O"), false, "O is not in the alphabet");
    assert.equal(isToken("k7m2xq9b"), false, "isToken is exact; parseToken does the normalising");
  });

  // The regression that mattered: the booth's manual-entry field uppercases as
  // you type so an 8-character code is never half-shifted — which also
  // uppercases a PASTED pass URL. A case-sensitive "/q/p/" test then dropped
  // it, and every such scan failed to award a letter while saying nothing.
  test("a pass URL is parsed regardless of case", () => {
    assert.equal(parseToken("https://teachers.littlequrankids.sg/q/p/K7M2XQ9B"), "K7M2XQ9B");
    assert.equal(parseToken("HTTPS://TEACHERS.LITTLEQURANKIDS.SG/Q/P/K7M2XQ9B"), "K7M2XQ9B");
    assert.equal(parseToken("/q/p/k7m2xq9b"), "K7M2XQ9B");
  });

  test("a bare code is accepted however it was typed or read back", () => {
    assert.equal(parseToken("k7m2xq9b"), "K7M2XQ9B");
    assert.equal(parseToken("  K7M2XQ9B  "), "K7M2XQ9B");
    assert.equal(parseToken("K7M2 XQ9B"), "K7M2XQ9B", "the space the pass prints");
    assert.equal(parseToken("K7M2-XQ9B"), "K7M2XQ9B");
  });

  test("query strings and fragments do not end up inside the token", () => {
    assert.equal(parseToken("https://x.sg/q/p/K7M2XQ9B?from=camera"), "K7M2XQ9B");
    assert.equal(parseToken("https://x.sg/q/p/K7M2XQ9B#top"), "K7M2XQ9B");
  });

  test("anything that is not a token is rejected rather than half-accepted", () => {
    assert.equal(parseToken(""), null);
    assert.equal(parseToken(null), null);
    assert.equal(parseToken("hello there"), null);
    assert.equal(parseToken("https://teachers.littlequrankids.sg/dashboard"), null);
    // A typed O or 0 is a misreading of a character that cannot occur; there is
    // nothing to recover, so it must fail loudly rather than resolve to someone.
    assert.equal(parseToken("K7M2XQ9O"), null);
    assert.equal(parseToken("K7M2XQ90"), null);
  });

  test("the printed form is grouped for reading aloud", () => {
    assert.equal(formatToken("K7M2XQ9B"), "K7M2 XQ9B");
    assert.equal(TOKEN_LENGTH, 8);
  });
});

describe("the word and the booths", () => {
  test("letters are taken uppercase, ignoring spacing", () => {
    assert.deepEqual(wordLetters("quran"), ["Q", "U", "R", "A", "N"]);
    assert.deepEqual(wordLetters("Eid Mubarak").length, 10);
  });

  // The invariant that only ever surfaces on the day: one booth short and the
  // word can never complete, so no family reaches the top tier; one too many
  // and a booth hands out nothing.
  test("the word must be exactly as long as the booth list", () => {
    assert.equal(wordFits("QURAN", 5), true);
    assert.equal(wordFits("QURAN", 4), false);
    assert.equal(wordFits("QURAN", 6), false);
  });
});

describe("reward tiers", () => {
  test("tiers are sorted and cleaned, and junk is dropped rather than shown", () => {
    const tiers = parseTiers(JSON.stringify([
      { at: 5, label: "Goodie bag" },
      { at: 3, label: "Sticker sheet" },
      { at: 0, label: "Nothing" },
      { at: 2, label: "" },
      "rubbish",
    ]));
    assert.deepEqual(tiers, [
      { at: 3, label: "Sticker sheet" },
      { at: 5, label: "Goodie bag" },
    ]);
  });

  test("malformed JSON yields no tiers instead of throwing on a live page", () => {
    assert.deepEqual(parseTiers("{not json"), []);
    assert.deepEqual(parseTiers(null), []);
  });

  test("a tier is earned at its threshold, and says how far off it is below it", () => {
    const tiers = parseTiers(JSON.stringify([{ at: 3, label: "Sticker" }, { at: 5, label: "Bag" }]));
    const state = tierState(tiers, 3, new Set());
    assert.equal(state[0].earned, true);
    assert.equal(state[1].earned, false);
    assert.equal(state[1].remaining, 2);
  });

  test("the counter offers the HIGHEST unclaimed tier the family has earned", () => {
    const tiers = parseTiers(JSON.stringify([{ at: 3, label: "Sticker" }, { at: 5, label: "Bag" }]));
    assert.equal(nextClaimable(tiers, 5, new Set()).label, "Bag");
    assert.equal(nextClaimable(tiers, 5, new Set([1])).label, "Sticker");
    assert.equal(nextClaimable(tiers, 5, new Set([0, 1])), null);
    assert.equal(nextClaimable(tiers, 2, new Set()), null);
  });
});

describe("the public leaderboard name", () => {
  // The board runs all day on a TV in a hall full of strangers. A child's name
  // must never reach it, so the display name is built only from what a parent
  // chose to make public.
  test("the nickname wins, then the surname, then a neutral label", () => {
    assert.equal(displayName({ nickname: "Team Rocket", surname: "Rahman" }), "Team Rocket");
    assert.equal(displayName({ nickname: "  ", surname: "Rahman" }), "The Rahman Family");
    assert.equal(displayName({ nickname: "", surname: "" }), "A family");
    assert.equal(displayName(null), "A family");
  });
});

/* The guards are UNIQUE constraints in the schema, not application logic, so
   they are exercised against a real database standing up the real DDL. */
describe("the schema's guards", () => {
  function freshDb() {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY);");
    db.exec(QR_SCHEMA_SQL);

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO qr_events (id, slug, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run("ev", "demo", "Demo", "open", now, now);

    const booths = ["b1", "b2"].map((id, i) => {
      db.prepare("INSERT INTO qr_booths (id, qr_event_id, name, position, created_at) VALUES (?,?,?,?,?)")
        .run(id, "ev", `Booth ${i + 1}`, i, now);
      return id;
    });
    const families = ["f1", "f2"].map((id, i) => {
      db.prepare(
        "INSERT INTO qr_families (id, qr_event_id, token, surname, created_at) VALUES (?,?,?,?,?)",
      ).run(id, "ev", `TOKEN${i}AA`, `Family${i}`, now);
      return id;
    });
    return { db, booths, families };
  }

  const award = (db, family, booth) =>
    db
      .prepare("INSERT INTO qr_visits (id, qr_event_id, family_id, booth_id, created_at) VALUES (?,?,?,?,?)")
      .run(randomUUID(), "ev", family, booth, new Date().toISOString());

  test("a booth cannot award the same family twice", () => {
    const { db, booths, families } = freshDb();
    award(db, families[0], booths[0]);
    assert.throws(() => award(db, families[0], booths[0]), /UNIQUE/);
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM qr_visits").get();
    assert.equal(n, 1, "the double scan left exactly one visit behind");
  });

  test("one family's progress never lands on another's pass", () => {
    const { db, booths, families } = freshDb();
    award(db, families[0], booths[0]);
    award(db, families[0], booths[1]);
    award(db, families[1], booths[0]);
    const count = (id) =>
      db.prepare("SELECT COUNT(*) AS n FROM qr_visits WHERE family_id = ?").get(id).n;
    assert.equal(count(families[0]), 2);
    assert.equal(count(families[1]), 1);
  });

  test("a prize cannot be handed to the same family twice", () => {
    const { db, families } = freshDb();
    const claim = () =>
      db
        .prepare(
          "INSERT INTO qr_claims (id, qr_event_id, family_id, tier_index, tier_label, created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(randomUUID(), "ev", families[0], 0, "Goodie bag", new Date().toISOString());
    claim();
    assert.throws(claim, /UNIQUE/);
  });

  // Two phones can hit "that's me" on the same guest-list entry within the same
  // second. Without the constraint the second one silently takes the first
  // family's place on the list, and "still to arrive" lies for the rest of the day.
  test("one name on the guest list cannot be claimed by two families", () => {
    const { db } = freshDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO qr_invitees (id, qr_event_id, name, search_name, created_at) VALUES (?,?,?,?,?)",
    ).run("i1", "ev", "Fatimah Rahman", "fatimah rahman", now);

    const claimName = (familyId, token) =>
      db
        .prepare(
          "INSERT INTO qr_families (id, qr_event_id, token, invitee_id, surname, created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(familyId, "ev", token, "i1", "Rahman", now);

    claimName("fa", "AAAA2222");
    assert.throws(() => claimName("fb", "BBBB3333"), /UNIQUE/);
  });

  // Several walk-ins is the normal case, so a NULL invitee must never collide
  // with another NULL — SQLite treats NULLs as distinct in a UNIQUE index, and
  // this pins that down rather than trusting it.
  test("walk-ins with no guest-list entry do not collide with each other", () => {
    const { db } = freshDb();
    const now = new Date().toISOString();
    const addWalkIn = db.prepare(
      "INSERT INTO qr_families (id, qr_event_id, token, invitee_id, surname, created_at) VALUES (?, ?, ?, NULL, ?, ?)",
    );
    addWalkIn.run("w1", "ev", "CCCC4444", "Walkin", now);
    addWalkIn.run("w2", "ev", "DDDD5555", "Walkin", now);

    const { n } = db.prepare("SELECT COUNT(*) AS n FROM qr_families WHERE invitee_id IS NULL").get();
    assert.equal(n, 4, "the two seeded families plus both walk-ins");
  });

  test("deleting an event takes its list, passes, visits and prizes with it", () => {
    // An event's data is disposable by design — archived after follow-up, then
    // dropped. A cascade that missed a table would leave orphans behind.
    const { db, booths, families } = freshDb();
    const now = new Date().toISOString();
    award(db, families[0], booths[0]);
    db.prepare("INSERT INTO qr_members (id, family_id, name, kind, position) VALUES (?,?,?,?,?)")
      .run(randomUUID(), families[0], "Aisyah", "child", 0);
    db.prepare("INSERT INTO qr_invitees (id, qr_event_id, name, search_name, created_at) VALUES (?,?,?,?,?)")
      .run("i9", "ev", "Someone", "someone", now);

    db.exec("DELETE FROM qr_events WHERE id = 'ev'");
    for (const table of ["qr_booths", "qr_families", "qr_visits", "qr_members", "qr_invitees", "qr_claims"]) {
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
      assert.equal(n, 0, `${table} still holds rows after the event was deleted`);
    }
  });
});

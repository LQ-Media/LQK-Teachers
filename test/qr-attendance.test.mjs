// QR Registration: pass tokens, the extra-details questions, and the schema
// constraints that decide what the attendance register says.
//
// The register is the point of the feature — it is what Karim has afterwards —
// so the rules worth pinning down are the ones that make it wrong: the same
// child marked present twice, a party's answers surviving an edit to the
// questions, and a deleted event leaving photographs of children behind.

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
  partyName,
  guessSurname,
} from "../lib/qr/tokens.js";

import { parseFields, validateAnswers, answerRows } from "../lib/qr/fields.js";
import { QR_SCHEMA_SQL } from "../lib/qr/schema.js";

describe("pass tokens", () => {
  test("the alphabet excludes every character a person misreads aloud", () => {
    for (const banned of ["I", "L", "O", "U", "0", "1"]) {
      assert.equal(TOKEN_ALPHABET.includes(banned), false, `${banned} must not be in the alphabet`);
    }
    assert.equal(new Set(TOKEN_ALPHABET).size, TOKEN_ALPHABET.length, "no duplicates");
    assert.equal(TOKEN_LENGTH, 8);
  });

  test("a well-formed token is 8 characters from that alphabet", () => {
    assert.equal(isToken("K7M2XQ9B"), true);
    assert.equal(isToken("K7M2XQ9"), false, "too short");
    assert.equal(isToken("K7M2XQ9O"), false, "O is not in the alphabet");
    assert.equal(isToken("k7m2xq9b"), false, "isToken is exact; parseToken normalises");
  });

  // The photo route is keyed on this, so a URL that fails to parse must fail
  // shut rather than resolving to somebody else's family picture.
  test("a pass URL parses regardless of case, spacing or query string", () => {
    assert.equal(parseToken("https://teachers.littlequrankids.sg/q/p/K7M2XQ9B"), "K7M2XQ9B");
    assert.equal(parseToken("HTTPS://TEACHERS.LITTLEQURANKIDS.SG/Q/P/K7M2XQ9B"), "K7M2XQ9B");
    assert.equal(parseToken("k7m2 xq9b"), "K7M2XQ9B");
    assert.equal(parseToken("https://x.sg/q/p/K7M2XQ9B?v=2"), "K7M2XQ9B");
  });

  test("anything that is not a token is rejected rather than half-accepted", () => {
    for (const bad of ["", null, "hello there", "https://x.sg/dashboard", "K7M2XQ9O", "K7M2XQ90"]) {
      assert.equal(parseToken(bad), null, `${bad} should not parse`);
    }
  });

  test("the printed form is grouped for reading aloud", () => {
    assert.equal(formatToken("K7M2XQ9B"), "K7M2 XQ9B");
  });
});

describe("naming a party", () => {
  test("the family name wins, then the contact, then a neutral label", () => {
    assert.equal(partyName({ family_name: "Rahman" }), "The Rahman Family");
    assert.equal(partyName({ family_name: "", contact_name: "Fatimah" }), "Fatimah");
    assert.equal(partyName({}), "A family");
    assert.equal(partyName(null), "A family");
  });

  test("a surname is guessed from the shapes real lists use", () => {
    // "Last, First" is what a spreadsheet export gives; taking the last word
    // instead produces "The Fatimah Family", which is a given name.
    assert.equal(guessSurname("Rahman, Fatimah"), "Rahman");
    assert.equal(guessSurname("Ahmad bin Ismail"), "Ismail");
    assert.equal(guessSurname("Nurul Huda binte Yusof"), "Yusof");
    assert.equal(guessSurname("Siti Aminah"), "Aminah");
    assert.equal(guessSurname("Zainab"), "Zainab");
    assert.equal(guessSurname(""), "");
  });
});

describe("the extra questions", () => {
  test("questions are cleaned, and unusable ones are dropped rather than shown", () => {
    const fields = parseFields([
      { label: "Dietary needs", type: "text" },
      { label: "", type: "text" },
      { label: "Transport", type: "choice", options: ["Car", "Bus"] },
      { label: "Broken", type: "choice", options: [] },
      { label: "Odd", type: "nonsense" },
    ]);
    assert.deepEqual(fields.map((f) => f.label), ["Dietary needs", "Transport", "Broken", "Odd"]);
    // A choice with no options is an unanswerable question — it becomes a text
    // box rather than a dropdown a parent cannot get past.
    assert.equal(fields.find((f) => f.label === "Broken").type, "text");
    assert.equal(fields.find((f) => f.label === "Odd").type, "text");
  });

  test("two questions with the same label get distinct ids", () => {
    // Sharing an id means one question silently overwrites the other's answers.
    const fields = parseFields([{ label: "Notes" }, { label: "Notes" }]);
    assert.equal(new Set(fields.map((f) => f.id)).size, 2);
  });

  test("malformed JSON yields no questions instead of throwing on a live door page", () => {
    assert.deepEqual(parseFields("{not json"), []);
    assert.deepEqual(parseFields(null), []);
  });

  test("a required question must be answered", () => {
    const fields = parseFields([{ label: "Car plate", type: "text", required: true }]);
    assert.equal(validateAnswers(fields, {}).ok, false);
    assert.equal(validateAnswers(fields, { "car-plate": "SGX1234A" }).ok, true);
  });

  test("an answer that was never offered is dropped, not stored", () => {
    // The only way to produce one is to edit the page.
    const fields = parseFields([{ label: "Transport", type: "choice", options: ["Car", "Bus"] }]);
    assert.deepEqual(validateAnswers(fields, { transport: "Helicopter" }).answers, {});
    assert.deepEqual(validateAnswers(fields, { transport: "Bus" }).answers, { transport: "Bus" });
  });

  test("yes/no only ever stores yes or no", () => {
    const fields = parseFields([{ label: "Halal only", type: "yesno" }]);
    assert.deepEqual(validateAnswers(fields, { "halal-only": "maybe" }).answers, {});
    assert.deepEqual(validateAnswers(fields, { "halal-only": "yes" }).answers, { "halal-only": "yes" });
  });

  test("answers pair back with their question for the register", () => {
    const fields = parseFields([{ label: "Dietary needs" }, { label: "Car plate" }]);
    assert.deepEqual(answerRows(fields, JSON.stringify({ "dietary-needs": "Nut allergy" })), [
      { label: "Dietary needs", value: "Nut allergy" },
    ]);
  });
});

/* The guards are constraints in the schema, not application logic, so they are
   exercised against a real database standing up the real DDL. */
describe("the schema's guards", () => {
  function freshDb() {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY);");
    db.exec(QR_SCHEMA_SQL);

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO qr_events (id, slug, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run("ev", "demo", "Open House", "open", now, now);

    db.prepare(
      "INSERT INTO qr_expected (id, qr_event_id, name, search_name, class_name, created_at) VALUES (?,?,?,?,?,?)",
    ).run("x1", "ev", "Aisyah Rahman", "aisyah rahman", "Iqra 2", now);

    const party = (id, token) =>
      db
        .prepare(
          "INSERT INTO qr_registrations (id, qr_event_id, token, family_name, created_at) VALUES (?,?,?,?,?)",
        )
        .run(id, "ev", token, "Rahman", now);
    party("r1", "AAAA2222");
    party("r2", "BBBB3333");
    return { db, now };
  }

  const markPresent = (db, id, registration, expectedId, name = "Aisyah Rahman") =>
    db
      .prepare(
        `INSERT INTO qr_attendance (id, qr_event_id, registration_id, expected_id, name, class_name, kind, position, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, "ev", registration, expectedId, name, "Iqra 2", "child", 0, new Date().toISOString());

  test("one expected person cannot be marked present twice", () => {
    // Otherwise a second family claiming the same child doubles the headcount
    // and "still to come" lies for the rest of the day.
    const { db } = freshDb();
    markPresent(db, "a1", "r1", "x1");
    assert.throws(() => markPresent(db, "a2", "r2", "x1"), /UNIQUE/);
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM qr_attendance").get();
    assert.equal(n, 1);
  });

  test("any number of unlisted family members can be added", () => {
    // NULLs do not collide in a SQLite UNIQUE index, and walk-ins are normal —
    // this pins that down rather than trusting it.
    const { db } = freshDb();
    markPresent(db, "a1", "r1", null, "Grandma");
    markPresent(db, "a2", "r1", null, "Uncle Yusuf");
    markPresent(db, "a3", "r2", null, "A cousin");
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM qr_attendance WHERE expected_id IS NULL").get();
    assert.equal(n, 3);
  });

  test("a family can hold only one generated picture", () => {
    const { db, now } = freshDb();
    const addPhoto = (id) =>
      db
        .prepare(
          `INSERT INTO qr_photos (id, qr_event_id, registration_id, status, file_name, mime, bytes, consent_text, consent_at, created_at)
           VALUES (?,?,?,'ready',?,?,?,?,?,?)`,
        )
        .run(id, "ev", "r1", `${randomUUID()}.png`, "image/png", 1000, "I agree", now, now);
    addPhoto("p1");
    assert.throws(() => addPhoto("p2"), /UNIQUE/);
  });

  test("deleting an event takes the list, the register and the photo rows with it", () => {
    // An event's data is disposable by design. A cascade that missed a table
    // would leave a row pointing at a photograph of somebody's children.
    const { db, now } = freshDb();
    markPresent(db, "a1", "r1", "x1");
    db.prepare(
      `INSERT INTO qr_photos (id, qr_event_id, registration_id, status, file_name, mime, bytes, consent_text, consent_at, created_at)
       VALUES (?,?,?,'ready',?,?,?,?,?,?)`,
    ).run("p1", "ev", "r1", `${randomUUID()}.png`, "image/png", 10, "I agree", now, now);
    db.prepare(
      "INSERT INTO qr_event_assets (id, qr_event_id, kind, file_name, mime, bytes, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("as1", "ev", "background", `${randomUUID()}.png`, "image/png", 10, now);

    db.exec("DELETE FROM qr_events WHERE id = 'ev'");
    for (const table of [
      "qr_expected",
      "qr_registrations",
      "qr_attendance",
      "qr_photos",
      "qr_event_assets",
    ]) {
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
      assert.equal(n, 0, `${table} still holds rows after the event was deleted`);
    }
  });

  test("removing a name from the list does not erase that person's attendance", () => {
    // They were in the room. Clearing a list must not rewrite history — the
    // row survives with expected_id nulled.
    const { db } = freshDb();
    markPresent(db, "a1", "r1", "x1");
    db.exec("DELETE FROM qr_expected WHERE id = 'x1'");
    const row = db.prepare("SELECT name, expected_id FROM qr_attendance WHERE id = 'a1'").get();
    assert.equal(row.name, "Aisyah Rahman");
    assert.equal(row.expected_id, null);
  });
});

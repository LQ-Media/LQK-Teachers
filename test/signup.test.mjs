// Who has signed up, and who a reminder is safe to send to.
//
// The stakes are unusual for a report: sending a reminder RESETS somebody's
// password. Get the state wrong and you lock a working teacher out of the
// portal the morning of their class. So the tests that matter are the ones
// about NOT sending — and about the third state, which is the one a tick-and-
// cross design would hide.
//
// Run under both timezones: the reminder rows are timestamped.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  STATES,
  STATE_LABEL,
  signupState,
  needsReminder,
  signupRow,
  tally,
  planSend,
  MAX_PER_SEND,
} from "../lib/admin/signup.js";
import { firstName, reminderSubject, reminderText, reminderHtml } from "../lib/admin/signup-email.js";

describe("the three states", () => {
  test("a password they chose means they have signed up", () => {
    // must_change_password = 0 is the only thing that clears it, and only the
    // person themselves can clear it — changePassword() requires their session.
    assert.equal(signupState({ mustChange: 0, lastLoginAt: "2026-09-10T01:00:00Z" }), "active");
  });

  test("a temp password nobody has ever used is 'never'", () => {
    assert.equal(signupState({ mustChange: 1, lastLoginAt: null }), "never");
  });

  test("a temp password on an account that HAS been used is 'reset', not 'never'", () => {
    // The state this module exists for. Calling it "never" would tell Karim
    // somebody has not signed up when in fact they did and an admin reset them
    // — he would chase the wrong problem, and the person is locked out now.
    assert.equal(signupState({ mustChange: 1, lastLoginAt: "2026-09-10T01:00:00Z" }), "reset");
  });

  test("an old account with its own password reads as signed up, with no login on record", () => {
    // last_login_at only started being recorded on 17 Sep 2026. The opposite
    // default would have declared all 71 existing accounts unsigned on the day
    // this shipped, and emailed every one of them a new password.
    assert.equal(signupState({ mustChange: 0, lastLoginAt: null }), "active");
  });

  test("the flags are read loosely, because SQLite hands back numbers", () => {
    assert.equal(signupState({ mustChange: 1, lastLoginAt: "" }), "never");
    assert.equal(signupState({ mustChange: false, lastLoginAt: null }), "active");
    assert.equal(signupState({ mustChange: undefined, lastLoginAt: undefined }), "active");
  });

  test("every state has a label, and no label is missing", () => {
    for (const s of STATES) assert.ok(STATE_LABEL[s], `${s} has no label`);
    assert.equal(Object.keys(STATE_LABEL).length, STATES.length);
  });
});

describe("who a reminder goes to", () => {
  test("the two stuck states get one, the signed-up state does not", () => {
    assert.equal(needsReminder("never"), true);
    assert.equal(needsReminder("reset"), true);
    assert.equal(needsReminder("active"), false);
  });

  test("an unknown state never gets one", () => {
    // Fails CLOSED. A new state nobody has classified must not be emailed a
    // password reset by default.
    assert.equal(needsReminder("something_new"), false);
    assert.equal(needsReminder(undefined), false);
    assert.equal(needsReminder(null), false);
    assert.equal(needsReminder(""), false);
  });
});

describe("shaping a row", () => {
  const row = {
    id: "t1",
    full_name: "NURUL HIDAYAH BINTE MOHD ARIS",
    email: "nurul@lqk.test",
    role: "teacher",
    position: "LEAD TEACHER",
    primary_location: "Woods Square",
    must_change_password: 1,
    last_login_at: null,
    created_at: "2026-09-01T00:00:00Z",
  };

  test("it carries the state and the raw timestamps", () => {
    const r = signupRow(row);
    assert.equal(r.state, "never");
    assert.equal(r.name, "NURUL HIDAYAH BINTE MOHD ARIS");
    assert.equal(r.lastLoginAt, null);
    assert.equal(r.reminderCount, 0);
  });

  test("dates are NOT formatted here", () => {
    // Formatting is the client's job. Doing it in a pure module would bake a
    // timezone into something both timezones run.
    const r = signupRow({ ...row, last_login_at: "2026-09-10T01:00:00.000Z" });
    assert.equal(r.lastLoginAt, "2026-09-10T01:00:00.000Z");
  });

  test("a missing position or branch becomes null, not the string 'null'", () => {
    const r = signupRow({ ...row, position: "", primary_location: null });
    assert.equal(r.position, null);
    assert.equal(r.primaryLocation, null);
  });
});

describe("the tally", () => {
  const mk = (mustChange, lastLoginAt) => signupRow({ id: randomUUID(), must_change_password: mustChange, last_login_at: lastLoginAt });

  test("outstanding is the two stuck states added together", () => {
    const rows = [
      mk(0, "2026-09-01T00:00:00Z"),
      mk(0, null),
      mk(1, null),
      mk(1, null),
      mk(1, "2026-09-01T00:00:00Z"),
    ];
    const t = tally(rows);
    assert.equal(t.total, 5);
    assert.equal(t.active, 2);
    assert.equal(t.never, 2);
    assert.equal(t.reset, 1);
    assert.equal(t.outstanding, 3);
  });

  test("an empty list tallies to zeros rather than undefined", () => {
    const t = tally([]);
    assert.equal(t.total, 0);
    assert.equal(t.outstanding, 0);
    assert.equal(t.active, 0);
  });
});

describe("the send cap", () => {
  test("a batch under the cap goes whole, with nothing held", () => {
    const p = planSend(["a", "b", "c"]);
    assert.deepEqual(p.send, ["a", "b", "c"]);
    assert.deepEqual(p.held, []);
  });

  test("a batch over the cap is split, and the remainder is NAMED", () => {
    // Resend's free tier is 100 a day shared with the Parents portal. The
    // remainder has to come back as ids, not as a count, so the second press
    // knows exactly who it still owes.
    const ids = [...Array(40)].map((_, i) => `id-${i}`);
    const p = planSend(ids);
    assert.equal(p.send.length, MAX_PER_SEND);
    assert.equal(p.held.length, 40 - MAX_PER_SEND);
    assert.deepEqual([...p.send, ...p.held], ids, "nobody is lost between the two halves");
  });

  test("duplicates are collapsed, so nobody is reset twice in one press", () => {
    // Two resets in one batch means the first email's password is already dead
    // before it arrives.
    const p = planSend(["a", "a", "b", "a"]);
    assert.deepEqual(p.send, ["a", "b"]);
  });

  test("blanks and whitespace are dropped", () => {
    assert.deepEqual(planSend(["  a  ", "", null, undefined, "b"]).send, ["a", "b"]);
  });

  test("no ids at all is an empty plan, not a crash", () => {
    assert.deepEqual(planSend([]).send, []);
    assert.deepEqual(planSend(null).send, []);
  });

  test("the cap can be lowered for a smaller batch", () => {
    assert.equal(planSend(["a", "b", "c"], { max: 2 }).send.length, 2);
  });
});

describe("the email", () => {
  const args = { fullName: "NURUL HIDAYAH BINTE MOHD ARIS", email: "nurul@lqk.test", tempPassword: "lqk-7kqm2r" };

  test("the greeting is the first name, title-cased", () => {
    // The imported names are in caps, so greeting somebody with the raw string
    // would shout at them.
    assert.equal(firstName("NURUL HIDAYAH BINTE MOHD ARIS"), "Nurul");
    assert.equal(firstName("firdaus hamzah"), "Firdaus");
    assert.equal(firstName("  Siti   Malia "), "Siti");
  });

  test("a missing name gives no greeting rather than 'undefined'", () => {
    assert.equal(firstName(""), "");
    assert.equal(firstName(null), "");
    assert.ok(!/undefined|null/.test(reminderText({ ...args, fullName: null })));
    assert.match(reminderText({ ...args, fullName: null }), /^Assalamualaikum,/);
  });

  test("the credentials are all present in both the text and the HTML", () => {
    for (const body of [reminderText(args), reminderHtml(args)]) {
      assert.ok(body.includes("nurul@lqk.test"), "the email address");
      assert.ok(body.includes("lqk-7kqm2r"), "the password");
    }
  });

  test("it says the password is temporary, in both bodies", () => {
    // The one thing that makes a credential in an inbox acceptable: it stops
    // working the moment it is used, and the person is told so.
    assert.match(reminderText(args), /temporary/i);
    assert.match(reminderHtml(args), /temporary/i);
  });

  test("it never says they failed to sign up", () => {
    // An email a manager triggered that opens with "you haven't signed up"
    // reads as a telling-off. The chasing belongs on the admin screen.
    const body = `${reminderText(args)} ${reminderHtml(args)}`.toLowerCase();
    for (const phrase of ["you have not", "you haven't signed up", "reminder:", "failed to"]) {
      assert.ok(!body.includes(phrase), `the copy should not contain "${phrase}"`);
    }
  });

  test("HTML-special characters in a name or password are escaped", () => {
    // A name with an ampersand is ordinary; one that breaks out of an attribute
    // is not, and the generated password is put inside markup too.
    const html = reminderHtml({ fullName: 'A<script>alert(1)</script>', email: 'a"b@lqk.test', tempPassword: "x&y" });
    assert.ok(!html.includes("<script>"), "no raw script tag");
    assert.ok(html.includes("&amp;"), "the ampersand is escaped");
    assert.ok(html.includes("&quot;"), "the quote is escaped");
  });

  test("the subject says whose account it is, and does not shame", () => {
    assert.match(reminderSubject(), /Little Quran Kids/);
    assert.ok(!/reminder/i.test(reminderSubject()));
  });

  test("the sign-in URL can be overridden, for a staging host", () => {
    assert.match(reminderText({ ...args, url: "https://staging.example.test" }), /staging\.example\.test/);
  });
});

// ---- Against a real database -------------------------------------------
//
// lib/actions/signup.js carries "use server", so the SQL is mirrored here. The
// part worth pinning is the reminder log: it is the only record that somebody's
// password was changed and the email telling them failed.

let db;
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-signup-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production";
  const mod = await import("../lib/db.js");
  db = mod.getDb();
});

after(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date().toISOString();

function person(id, name, { mustChange = 0, lastLogin = null } = {}) {
  db.prepare(
    `INSERT OR REPLACE INTO profiles (id, full_name, email, password_hash, role, must_change_password, last_login_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, name, `${id}@signup.test`, "x", "teacher", mustChange ? 1 : 0, lastLogin, NOW);
}

beforeEach(() => {
  db.exec("DELETE FROM signup_reminders");
  db.exec("DELETE FROM profiles");
  person("karim", "Nur Abdul Karim");
  person("fresh", "Never Signed In", { mustChange: 1 });
  person("reset", "Was Reset", { mustChange: 1, lastLogin: "2026-09-01T01:00:00Z" });
});

const remind = (subject, ok = true, error = null) =>
  db
    .prepare(
      `INSERT INTO signup_reminders (id, subject_id, email, sent_by, sent_by_name, ok, error, at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(randomUUID(), subject, `${subject}@signup.test`, "karim", "Nur Abdul Karim", ok ? 1 : 0, error, new Date().toISOString());

describe("the last_login_at column", () => {
  test("it exists and defaults to NULL — never invented", () => {
    // Backfilling a date would make "never signed in" wrong in the reassuring
    // direction for all 71 existing accounts.
    assert.equal(db.prepare("SELECT last_login_at FROM profiles WHERE id='karim'").get().last_login_at, null);
  });

  test("stamping it is a plain update", () => {
    const at = new Date().toISOString();
    db.prepare("UPDATE profiles SET last_login_at = ? WHERE id = 'karim'").run(at);
    assert.equal(db.prepare("SELECT last_login_at FROM profiles WHERE id='karim'").get().last_login_at, at);
  });

  test("the three states read back off real rows", () => {
    const rows = db
      .prepare("SELECT id, must_change_password, last_login_at FROM profiles ORDER BY id")
      .all()
      .map((r) => [r.id, signupState({ mustChange: r.must_change_password, lastLoginAt: r.last_login_at })]);
    assert.deepEqual(rows, [
      ["fresh", "never"],
      ["karim", "active"],
      ["reset", "reset"],
    ]);
  });
});

describe("the reminder log", () => {
  test("a successful send is counted, a failed one is not", () => {
    // The count on the screen is "how many times have they been TOLD", so a
    // failed send must not inflate it — or somebody reads "reminded 3×" about
    // a person who never got an email.
    remind("fresh", true);
    remind("fresh", false, "Resend returned 429");
    const row = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM signup_reminders WHERE subject_id='fresh' AND ok=1) AS ok_count,
                (SELECT COUNT(*) FROM signup_reminders WHERE subject_id='fresh') AS all_count`
      )
      .get();
    assert.equal(row.ok_count, 1);
    assert.equal(row.all_count, 2, "but the failure is still recorded");
  });

  test("a failure keeps its reason", () => {
    remind("fresh", false, "Resend returned 429");
    assert.equal(db.prepare("SELECT error FROM signup_reminders WHERE ok=0").get().error, "Resend returned 429");
  });

  test("the log survives the admin who sent it leaving", () => {
    remind("fresh", true);
    db.prepare("DELETE FROM profiles WHERE id='karim'").run();
    const r = db.prepare("SELECT sent_by, sent_by_name FROM signup_reminders").get();
    assert.equal(r.sent_by, null, "the fk is nulled");
    assert.equal(r.sent_by_name, "Nur Abdul Karim", "the name still reads");
  });

  test("deleting the account takes its reminders with it", () => {
    remind("fresh", true);
    db.prepare("DELETE FROM profiles WHERE id='fresh'").run();
    assert.equal(db.prepare("SELECT COUNT(*) c FROM signup_reminders").get().c, 0);
  });

  test("the email written to is kept even if the account's changes later", () => {
    // Denormalised on purpose: "we emailed them" is a statement about an
    // address, and if it was the wrong one that is the thing to find out.
    remind("fresh", true);
    db.prepare("UPDATE profiles SET email = 'new@signup.test' WHERE id='fresh'").run();
    assert.equal(db.prepare("SELECT email FROM signup_reminders").get().email, "fresh@signup.test");
  });

  test("several reminders to one person read newest first", () => {
    remind("fresh", true);
    remind("fresh", false, "bounced");
    remind("fresh", true);
    const rows = db
      .prepare("SELECT ok FROM signup_reminders WHERE subject_id='fresh' ORDER BY at DESC, rowid DESC")
      .all()
      .map((r) => r.ok);
    assert.deepEqual(rows, [1, 0, 1]);
  });
});

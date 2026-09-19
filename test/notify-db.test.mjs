// The database half of shift notifications: who gets told, and told once.
//
// lib/hours/notify-scheduler.js is "server-only" and imports through the "@/"
// alias, so it cannot be imported here. The queries that matter are mirrored
// below against a REAL database created by the real migration — which is the
// half worth testing anyway, because the bugs available here are the silent
// ones: a duplicate nobody notices until a teacher complains, and a
// notification that reaches nobody at all.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

let db;
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-notify-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production";
  const mod = await import("../lib/db.js");
  db = mod.getDb();

  const now = new Date().toISOString();
  const person = (id, name, role, scope) =>
    db
      .prepare(
        "INSERT INTO profiles (id, full_name, email, password_hash, role, admin_scope, created_at) VALUES (?,?,?,?,?,?,?)"
      )
      .run(id, name, `${id}@notify.local`, "x", role, scope, now);

  person("karim", "Nur Abdul Karim", "admin", "full");
  person("suaidah", "Siti Suaidah", "admin", "full");
  person("zafirah", "Zafirah", "admin", "centre"); // Woods Square
  person("mellisha", "Mellisha", "admin", "centre"); // Woods Square too
  person("khai", "Khairunnisaa'", "admin", "centre"); // the two Tampines
  person("aisyah", "Nur Aisyah", "teacher", null);

  const link = (mid, branch) =>
    db
      .prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?,?,?)")
      .run(randomUUID(), mid, branch);
  link("zafirah", "Woods Square");
  link("mellisha", "Woods Square");
  link("khai", "Tampines Blk 462");
  link("khai", "Tampines Junction");

  db.prepare(
    `INSERT INTO shifts (id, teacher_id, category, branch, date, start_time, end_time,
                         starts_at, ends_at, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    "shift1",
    "aisyah",
    "teaching",
    "Woods Square",
    "2026-09-17",
    "19:30",
    "21:30",
    "2026-09-17T11:30:00.000Z",
    "2026-09-17T13:30:00.000Z",
    "planned",
    now,
    now
  );
});

after(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => db.exec("DELETE FROM shift_notifications"));

// Mirrors claim() in lib/hours/notify-scheduler.js.
function claim(shiftId, kind, recipientId) {
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO shift_notifications (id, shift_id, kind, recipient_id, sent_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), shiftId, kind, recipientId, new Date().toISOString()).changes > 0
  );
}

// Mirrors managersForBranch().
function managersForBranch(branch) {
  if (branch) {
    const centre = db
      .prepare(
        `SELECT DISTINCT p.id FROM profiles p
         JOIN manager_branches m ON m.manager_id = p.id
         WHERE p.role = 'admin' AND m.branch = ?`
      )
      .all(branch)
      .map((r) => r.id);
    if (centre.length) return centre;
  }
  return db
    .prepare("SELECT id FROM profiles WHERE role = 'admin' AND admin_scope = 'full'")
    .all()
    .map((r) => r.id);
}

describe("claiming a notification", () => {
  test("the first claim wins and the second is refused", () => {
    // This is the whole anti-duplicate mechanism. If it stops working, every
    // redeploy re-sends every pending reminder.
    assert.equal(claim("shift1", "reminder", "aisyah"), true);
    assert.equal(claim("shift1", "reminder", "aisyah"), false);
    assert.equal(claim("shift1", "reminder", "aisyah"), false);
  });

  test("a restart cannot re-send — the record is on disk, not in memory", () => {
    claim("shift1", "reminder", "aisyah");
    const rows = db
      .prepare("SELECT COUNT(*) c FROM shift_notifications WHERE shift_id='shift1' AND kind='reminder'")
      .get().c;
    assert.equal(rows, 1);
    assert.equal(claim("shift1", "reminder", "aisyah"), false);
  });

  test("different kinds of notification are independent", () => {
    assert.equal(claim("shift1", "reminder", "aisyah"), true);
    assert.equal(claim("shift1", "no_clock_in", "aisyah"), true);
    assert.equal(claim("shift1", "offered", "aisyah"), true);
  });

  test("each recipient is claimed separately", () => {
    assert.equal(claim("shift1", "no_clock_in", "aisyah"), true);
    assert.equal(claim("shift1", "no_clock_in:mgr", "zafirah"), true);
    assert.equal(claim("shift1", "no_clock_in:mgr", "mellisha"), true);
    assert.equal(claim("shift1", "no_clock_in:mgr", "zafirah"), false);
  });

  test("the teacher's copy and the manager's copy do not collide", () => {
    // They use different kind strings precisely so that an admin who is ALSO
    // the teacher on a shift can receive both, or neither, independently.
    assert.equal(claim("shift1", "no_clock_in", "zafirah"), true);
    assert.equal(claim("shift1", "no_clock_in:mgr", "zafirah"), true);
  });

  test("deleting the shift takes its notification log with it", () => {
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, branch, date, start_time, end_time,
                           starts_at, ends_at, status, created_at, updated_at)
       VALUES ('tmp','aisyah','teaching','Woods Square','2026-09-18','19:30','21:30',
               '2026-09-18T11:30:00.000Z','2026-09-18T13:30:00.000Z','planned','x','x')`
    ).run();
    claim("tmp", "reminder", "aisyah");
    db.prepare("DELETE FROM shifts WHERE id='tmp'").run();
    assert.equal(
      db.prepare("SELECT COUNT(*) c FROM shift_notifications WHERE shift_id='tmp'").get().c,
      0
    );
  });
});

describe("who hears about a missing clock-in", () => {
  test("the IT Heads of that centre, all of them", () => {
    assert.deepEqual(managersForBranch("Woods Square").sort(), ["mellisha", "zafirah"]);
  });

  test("an IT Head covering two centres hears about both", () => {
    assert.ok(managersForBranch("Tampines Blk 462").includes("khai"));
    assert.ok(managersForBranch("Tampines Junction").includes("khai"));
  });

  test("and NOT about somebody else's centre", () => {
    assert.ok(!managersForBranch("Woods Square").includes("khai"));
    assert.ok(!managersForBranch("Tampines Junction").includes("zafirah"));
  });

  test("full admins are not copied on every centre's late taps", () => {
    // Four people receiving every late tap across five centres is a mute
    // button waiting to happen.
    const heard = managersForBranch("Woods Square");
    assert.ok(!heard.includes("karim"));
    assert.ok(!heard.includes("suaidah"));
  });

  test("a branch nobody manages falls back to the full admins, never to silence", () => {
    // The failure direction that matters: somebody is always told. An empty
    // list here is the bug where everyone assumes someone else was notified.
    const heard = managersForBranch("Primz Bizhub");
    assert.deepEqual(heard.sort(), ["karim", "suaidah"]);
    assert.ok(heard.length > 0);
  });

  test("a shift with no branch at all still reaches the full admins", () => {
    const heard = managersForBranch(null);
    assert.deepEqual(heard.sort(), ["karim", "suaidah"]);
  });

  test("a teacher is never a recipient by virtue of being at the branch", () => {
    for (const branch of ["Woods Square", "Tampines Junction", null]) {
      assert.ok(!managersForBranch(branch).includes("aisyah"), `${branch} notified a teacher`);
    }
  });
});

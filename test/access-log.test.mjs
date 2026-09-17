// Setting one person's admin access, and the trail it leaves.
//
// The actions in lib/actions/admin-scopes.js are "use server" and import
// through "@/", so the SQL and the guards are mirrored here against a real
// database. That is the half worth testing: this is the code that hands out
// payroll access, so the tests that matter prove it REFUSES, and prove the
// record survives.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

let db;
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-acclog-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production";
  const mod = await import("../lib/db.js");
  db = mod.getDb();
});

after(() => rmSync(dir, { recursive: true, force: true }));

function person(id, name, role = "teacher", scope = null) {
  db.prepare(
    "INSERT OR REPLACE INTO profiles (id, full_name, email, password_hash, role, admin_scope, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, name, `${id}@log.local`, "x", role, scope, new Date().toISOString());
}

beforeEach(() => {
  db.exec("DELETE FROM admin_scope_log");
  db.exec("DELETE FROM manager_branches");
  db.exec("DELETE FROM profiles");
  person("karim", "Nur Abdul Karim", "admin", "full");
  person("suaidah", "Siti Suaidah", "admin", "full");
  person("zafirah", "Zafirah", "admin", "centre");
  person("teacher", "A Teacher");
});

/** Mirrors the scope read in accessRoster / setAdminScope. */
function scopeOf(id) {
  const r = db.prepare("SELECT role, admin_scope FROM profiles WHERE id = ?").get(id);
  if (!r) return null;
  return r.role !== "admin" ? "none" : r.admin_scope === "full" ? "full" : "centre";
}

/** Mirrors the "is this the last full admin" guard. */
function otherFullAdmins(excludeId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM profiles WHERE role = 'admin' AND admin_scope = 'full' AND id != ?")
    .get(excludeId).n;
}

function logChange(subject, by, byName, from, to, fromBranches, toBranches) {
  db.prepare(
    `INSERT INTO admin_scope_log (id, subject_id, changed_by, changed_by_name, from_scope, to_scope, from_branches, to_branches, changed_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(randomUUID(), subject, by, byName, from, to, fromBranches, toBranches, new Date().toISOString());
}

describe("reading what somebody holds", () => {
  test("the three states are told apart", () => {
    assert.equal(scopeOf("karim"), "full");
    assert.equal(scopeOf("zafirah"), "centre");
    assert.equal(scopeOf("teacher"), "none");
  });

  test("an admin with a NULL scope reads as centre, never as full", () => {
    person("orphan", "Legacy", "admin", null);
    assert.equal(scopeOf("orphan"), "centre");
  });
});

describe("the lock-out guards", () => {
  test("with two full admins, demoting one leaves the other", () => {
    assert.equal(otherFullAdmins("karim"), 1);
  });

  test("with one full admin left, the guard sees nobody else", () => {
    // The state the guard exists to refuse: demoting this person would leave
    // nobody who can reach payroll or the Access screen ever again.
    db.prepare("UPDATE profiles SET role='teacher', admin_scope=NULL WHERE id='suaidah'").run();
    assert.equal(otherFullAdmins("karim"), 0);
  });

  test("a centre admin does not count as a way back in", () => {
    db.prepare("UPDATE profiles SET role='teacher', admin_scope=NULL WHERE id='suaidah'").run();
    // Zafirah is still an admin, but centre-only — she cannot open Access.
    assert.equal(scopeOf("zafirah"), "centre");
    assert.equal(otherFullAdmins("karim"), 0);
  });
});

describe("applying a change", () => {
  test("none clears the branches as well as the role", () => {
    db.prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?,?,?)").run(
      randomUUID(),
      "zafirah",
      "Woods Square"
    );
    db.exec("BEGIN");
    db.prepare("UPDATE profiles SET role='teacher', admin_scope=NULL WHERE id='zafirah'").run();
    db.prepare("DELETE FROM manager_branches WHERE manager_id='zafirah'").run();
    db.exec("COMMIT");
    assert.equal(scopeOf("zafirah"), "none");
    assert.equal(
      db.prepare("SELECT COUNT(*) c FROM manager_branches WHERE manager_id='zafirah'").get().c,
      0
    );
  });

  test("centre branches are replaced wholesale, not merged", () => {
    // Otherwise removing somebody from a centre would be impossible through
    // this screen — you could only ever add.
    const add = (b) =>
      db.prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?,?,?)").run(
        randomUUID(),
        "zafirah",
        b
      );
    add("Woods Square");
    add("Primz Bizhub");
    db.prepare("DELETE FROM manager_branches WHERE manager_id='zafirah'").run();
    add("Tampines Junction");
    const now = db
      .prepare("SELECT branch FROM manager_branches WHERE manager_id='zafirah' ORDER BY branch")
      .all()
      .map((r) => r.branch);
    assert.deepEqual(now, ["Tampines Junction"]);
  });
});

describe("the audit trail", () => {
  test("a change records who did it, to whom, and both scopes", () => {
    logChange("zafirah", "karim", "Nur Abdul Karim", "none", "centre", null, "Woods Square");
    const r = db.prepare("SELECT * FROM admin_scope_log").get();
    assert.equal(r.subject_id, "zafirah");
    assert.equal(r.changed_by, "karim");
    assert.equal(r.from_scope, "none");
    assert.equal(r.to_scope, "centre");
    assert.equal(r.to_branches, "Woods Square");
  });

  test("the log survives the person who made the change leaving", () => {
    // ON DELETE SET NULL on changed_by, with the NAME denormalised — which is
    // the whole reason the name column exists. An audit trail that forgets who
    // acted the moment they leave is no trail at all.
    logChange("zafirah", "karim", "Nur Abdul Karim", "centre", "full", null, null);
    db.prepare("DELETE FROM profiles WHERE id = 'karim'").run();
    const r = db.prepare("SELECT * FROM admin_scope_log").get();
    assert.equal(r.changed_by, null, "the fk should be nulled, not the row deleted");
    assert.equal(r.changed_by_name, "Nur Abdul Karim", "the name must still read");
  });

  test("the log does NOT survive the subject being deleted", () => {
    // Deliberately the other way round: the subject's rows cascade, because a
    // deleted account's permission history is about a person who no longer
    // exists in the portal at all.
    logChange("zafirah", "karim", "Nur Abdul Karim", "none", "centre", null, "Woods Square");
    db.prepare("DELETE FROM profiles WHERE id = 'zafirah'").run();
    assert.equal(db.prepare("SELECT COUNT(*) c FROM admin_scope_log").get().c, 0);
  });

  test("several changes to one person are all kept, in order", () => {
    logChange("teacher", "karim", "Karim", "none", "centre", null, "Woods Square");
    logChange("teacher", "suaidah", "Suaidah", "centre", "full", "Woods Square", null);
    logChange("teacher", "karim", "Karim", "full", "none", null, null);
    const rows = db
      .prepare(
        // rowid, as accessLog does: all three rows land in the same
        // millisecond, so changed_at alone is not a total order.
        "SELECT from_scope, to_scope FROM admin_scope_log WHERE subject_id='teacher' ORDER BY changed_at ASC, rowid ASC"
      )
      .all();
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => `${r.from_scope}->${r.to_scope}`), [
      "none->centre",
      "centre->full",
      "full->none",
    ]);
  });
});

describe("shift history", () => {
  beforeEach(() => {
    db.exec("DELETE FROM shift_history");
    db.exec("DELETE FROM shifts");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, branch, date, start_time, end_time, starts_at, ends_at, status, created_at, updated_at)
       VALUES ('s1','teacher','teaching','Woods Square','2026-09-25','10:00','13:00',
               '2026-09-25T02:00:00.000Z','2026-09-25T05:00:00.000Z','planned',?,?)`
    ).run(now, now);
  });

  const log = (action, field, from, to, actor = "karim", name = "Nur Abdul Karim") =>
    db
      .prepare(
        `INSERT INTO shift_history (id, shift_id, actor_id, actor_name, action, field, from_value, to_value, at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(randomUUID(), "s1", actor, name, action, field, from, to, new Date().toISOString());

  test("a field change records the field and both values", () => {
    log("edited", "end time", "13:00", "14:30");
    const r = db.prepare("SELECT * FROM shift_history").get();
    assert.equal(r.field, "end time");
    assert.equal(r.from_value, "13:00");
    assert.equal(r.to_value, "14:30");
  });

  test("entries read oldest first, so the story runs top to bottom", () => {
    log("created", null, null, null);
    log("edited", "end time", "13:00", "14:00");
    log("reassigned", "teacher", "A", "B");
    const rows = db
      .prepare("SELECT action FROM shift_history WHERE shift_id='s1' ORDER BY at ASC, rowid ASC")
      .all()
      .map((r) => r.action);
    assert.deepEqual(rows, ["created", "edited", "reassigned"]);
  });

  test("deleting the shift takes its history with it", () => {
    log("created", null, null, null);
    db.prepare("DELETE FROM shifts WHERE id='s1'").run();
    assert.equal(db.prepare("SELECT COUNT(*) c FROM shift_history").get().c, 0);
  });

  test("history outlives the person who made the change", () => {
    log("edited", "end time", "13:00", "14:00");
    db.prepare("DELETE FROM profiles WHERE id='karim'").run();
    const r = db.prepare("SELECT actor_id, actor_name FROM shift_history").get();
    assert.equal(r.actor_id, null);
    assert.equal(r.actor_name, "Nur Abdul Karim");
  });
});

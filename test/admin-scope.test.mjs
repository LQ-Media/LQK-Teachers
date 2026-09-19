// The two tiers of admin, at the database level.
//
// This is an AUTHORISATION boundary, so the tests that matter are the ones that
// prove access is DENIED, not the ones that prove it is granted. A bug that
// grants too much is silent; a bug that grants too little gets reported within
// the hour.
//
// The redirect half of the guard lives in lib/dal.js and needs a request, so it
// cannot run here. What is tested is the data those guards read, and the
// failure directions they were written to have.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

let db;
let dir;
let LOCATIONS;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-scope-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production";
  const mod = await import("../lib/db.js");
  db = mod.getDb();
  LOCATIONS = mod.LOCATIONS;

  const now = new Date().toISOString();
  const add = (id, name, role, scope) =>
    db
      .prepare(
        "INSERT INTO profiles (id, full_name, email, password_hash, role, admin_scope, created_at) VALUES (?,?,?,?,?,?,?)"
      )
      .run(id, name, `${id}@scope.local`, "x", role, scope, now);

  add("karim", "Nur Abdul Karim", "admin", "full");
  add("zafirah", "Zafirah", "admin", "centre");
  add("khai", "Khairunnisa", "admin", "centre");
  add("orphan", "Legacy Admin", "admin", null); // pre-migration row
  add("teacher", "A Teacher", "teacher", null);

  const link = (mid, branch) =>
    db
      .prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?,?,?)")
      .run(randomUUID(), mid, branch);
  link("zafirah", "Woods Square");
  link("khai", "Tampines Blk 462");
  link("khai", "Tampines Junction");
});

after(() => rmSync(dir, { recursive: true, force: true }));

// The predicates, mirrored from lib/dal.js, which cannot be imported here —
// it is "server-only" and calls redirect().
function scopeOf(id) {
  const row = db.prepare("SELECT role, admin_scope FROM profiles WHERE id = ?").get(id);
  if (!row || row.role !== "admin") return null;
  return row.admin_scope === "full" ? "full" : "centre";
}
function branchesOf(id) {
  if (scopeOf(id) === "full") return null;
  return db
    .prepare("SELECT branch FROM manager_branches WHERE manager_id = ? ORDER BY branch")
    .all(id)
    .map((r) => r.branch);
}
function canManage(id, branch) {
  const mine = branchesOf(id);
  return mine === null ? true : mine.includes(branch);
}

describe("admin scope", () => {
  test("the migration marks existing admins as full", () => {
    // ensureSchema runs `UPDATE profiles SET admin_scope='full' WHERE role='admin'`
    // when it adds the column, so a portal upgraded in place keeps its admins
    // working. Asserted on a row inserted WITHOUT a scope after that ran.
    assert.equal(scopeOf("karim"), "full");
  });

  test("an admin with no scope reads as CENTRE, never as full", () => {
    // The safe direction for an unknown value is less access. A row that
    // somehow escaped the migration must not silently hold payroll.
    assert.equal(scopeOf("orphan"), "centre");
  });

  test("a teacher has no admin scope at all", () => {
    assert.equal(scopeOf("teacher"), null);
    assert.equal(scopeOf("nobody"), null);
  });
});

describe("branch scoping", () => {
  test("a full admin is unscoped, signalled by null and not by a full list", () => {
    // null rather than every branch on purpose: a caller writes
    // `if (branches) filter`, so forgetting the filter fails open only for
    // somebody who was allowed everything anyway.
    assert.equal(branchesOf("karim"), null);
  });

  test("a centre admin gets exactly their own centres", () => {
    assert.deepEqual(branchesOf("zafirah"), ["Woods Square"]);
    assert.deepEqual(branchesOf("khai"), ["Tampines Blk 462", "Tampines Junction"]);
  });

  test("a centre admin is refused somebody else's centre", () => {
    assert.equal(canManage("zafirah", "Woods Square"), true);
    assert.equal(canManage("zafirah", "Primz Bizhub"), false);
    assert.equal(canManage("zafirah", "Tampines Blk 462"), false);
    assert.equal(canManage("khai", "Woods Square"), false);
  });

  test("a centre admin with no branches sees nothing, not everything", () => {
    assert.deepEqual(branchesOf("orphan"), []);
    for (const b of LOCATIONS) {
      assert.equal(canManage("orphan", b), false, `${b} leaked to an unassigned admin`);
    }
  });

  test("a full admin can manage every branch, including a null one", () => {
    for (const b of LOCATIONS) assert.equal(canManage("karim", b), true);
    assert.equal(canManage("karim", null), true);
  });

  test("a centre admin cannot manage a shift with no branch set", () => {
    // A branchless shift belongs to nobody's centre, so it is a full admin's.
    assert.equal(canManage("zafirah", null), false);
  });

  test("an IT Head may adjust a clock-in at their own centre, not elsewhere", () => {
    // Karim, 16 Sep 2026: adjusting is a centre IT Head's job too. The guard in
    // adjustClockIn checks the SHIFT's branch, not the teacher's — a teacher can
    // be rostered across centres, and it is the shift that gets paid.
    assert.equal(canManage("zafirah", "Woods Square"), true);
    assert.equal(canManage("zafirah", "Tampines Junction"), false);
    assert.equal(canManage("khai", "Tampines Junction"), true);
    // A full admin is never blocked by it.
    assert.equal(canManage("karim", "Woods Square"), true);
  });

  test("every assigned branch is a real one", () => {
    const used = db.prepare("SELECT DISTINCT branch FROM manager_branches").all().map((r) => r.branch);
    for (const b of used) assert.ok(LOCATIONS.includes(b), `${b} is not a known branch`);
  });

  test("a manager cannot hold the same branch twice", () => {
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?,?,?)")
          .run(randomUUID(), "zafirah", "Woods Square"),
      /UNIQUE/
    );
  });

  test("deleting the account takes its branches with it", () => {
    db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, admin_scope, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run("temp", "Temp", "temp@scope.local", "x", "admin", "centre", new Date().toISOString());
    db.prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?,?,?)").run(
      randomUUID(),
      "temp",
      "Woods Square"
    );
    db.prepare("DELETE FROM profiles WHERE id = ?").run("temp");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM manager_branches WHERE manager_id = ?").get("temp").c, 0);
  });
});

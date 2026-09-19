// Relief: offering a shift, and exactly one person taking it.
//
// lib/actions/relief.js carries "use server" and imports through the "@/" alias,
// so it cannot be imported here. The SQL that decides who wins is mirrored below
// against a REAL database built by the real migration — and that SQL is the part
// worth testing, because the failure it prevents is two teachers both being told
// they got the shift and both turning up.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let db;
let dir;

const SOON = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
const SOON_END = new Date(Date.now() + 8 * 3600 * 1000).toISOString();

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-relief-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production";
  const mod = await import("../lib/db.js");
  db = mod.getDb();

  const now = new Date().toISOString();
  for (const [id, name] of [
    ["aisyah", "Nur Aisyah"],
    ["huda", "Nurul Huda"],
    ["siti", "Siti Malia"],
    ["zafirah", "Zafirah"],
  ]) {
    db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)"
    ).run(id, name, `${id}@relief.local`, "x", "teacher", now);
  }
});

after(() => rmSync(dir, { recursive: true, force: true }));

function makeShift(id, teacher, startsAt = SOON, endsAt = SOON_END, status = "planned") {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO shifts (id, teacher_id, category, branch, date, start_time, end_time,
                         starts_at, ends_at, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, teacher, "teaching", "Woods Square", startsAt.slice(0, 10), "19:30", "21:30",
        startsAt, endsAt, status, now, now);
}

function offer(id, from) {
  const now = new Date().toISOString();
  return db
    .prepare(
      `UPDATE shifts SET offered_at = ?, offered_by = ?, offer_from = ?, updated_at = ?
       WHERE id = ? AND offered_at IS NULL`
    )
    .run(now, from, from, now, id).changes;
}

// Mirrors the claim in takeShift(). The guard on offered_at is the mechanism.
function take(id, uid) {
  const now = new Date().toISOString();
  try {
    return db
      .prepare(
        `UPDATE shifts SET teacher_id = ?, taken_by = ?, taken_at = ?, offered_at = NULL, updated_at = ?
         WHERE id = ? AND offered_at IS NOT NULL AND status != 'cancelled'`
      )
      .run(uid, uid, now, now, id).changes;
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) return "clash";
    throw err;
  }
}

const get = (id) => db.prepare("SELECT * FROM shifts WHERE id = ?").get(id);

beforeEach(() => db.exec("DELETE FROM shifts"));

describe("offering", () => {
  test("puts the shift on the board and remembers who gave it up", () => {
    makeShift("s1", "aisyah");
    assert.equal(offer("s1", "aisyah"), 1);
    const row = get("s1");
    assert.ok(row.offered_at);
    assert.equal(row.offer_from, "aisyah");
    // teacher_id has NOT moved yet — it is still hers until somebody takes it.
    assert.equal(row.teacher_id, "aisyah");
  });

  test("offering twice is a no-op, not a second offer", () => {
    makeShift("s1", "aisyah");
    assert.equal(offer("s1", "aisyah"), 1);
    assert.equal(offer("s1", "aisyah"), 0);
  });
});

describe("taking — the race", () => {
  test("exactly one of four simultaneous takers wins", () => {
    // The test this file exists for. Four claims, one shift, one winner.
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    const results = ["huda", "siti", "zafirah", "huda"].map((u) => take("s1", u));
    assert.equal(results.filter((r) => r === 1).length, 1, `winners: ${JSON.stringify(results)}`);
  });

  test("the winner ends up holding the shift", () => {
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    assert.equal(take("s1", "huda"), 1);
    const row = get("s1");
    assert.equal(row.teacher_id, "huda");
    assert.equal(row.taken_by, "huda");
    assert.ok(row.taken_at);
  });

  test("and it leaves the board the instant it is taken", () => {
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    take("s1", "huda");
    assert.equal(get("s1").offered_at, null);
    // Which is what makes the second claim fail, rather than a read-then-write.
    assert.equal(take("s1", "siti"), 0);
  });

  test("the original holder survives the handover", () => {
    // "Who gave this shift up" is the first thing anyone asks a month later,
    // and teacher_id has moved by then.
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    take("s1", "huda");
    const row = get("s1");
    assert.equal(row.offer_from, "aisyah");
    assert.equal(row.teacher_id, "huda");
  });

  test("a shift nobody offered cannot be taken", () => {
    makeShift("s1", "aisyah");
    assert.equal(take("s1", "huda"), 0);
  });

  test("a cancelled shift cannot be taken even while offered", () => {
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    db.prepare("UPDATE shifts SET status = 'cancelled' WHERE id = 's1'").run();
    assert.equal(take("s1", "huda"), 0);
  });

  test("withdrawing takes it off the board and blocks a later take", () => {
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    db.prepare("UPDATE shifts SET offered_at = NULL WHERE id = 's1'").run();
    assert.equal(take("s1", "huda"), 0);
  });
});

describe("clashes", () => {
  // Mirrors the overlap query in takeShift.
  function overlaps(uid, shiftId) {
    const row = get(shiftId);
    return !!db
      .prepare(
        `SELECT id FROM shifts WHERE teacher_id = ? AND status = 'planned' AND id != ?
           AND starts_at < ? AND ends_at > ?`
      )
      .get(uid, shiftId, row.ends_at, row.starts_at);
  }

  test("a teacher already teaching at that time is refused", () => {
    makeShift("s1", "aisyah");
    makeShift("s2", "huda"); // same window
    offer("s1", "aisyah");
    assert.equal(overlaps("huda", "s1"), true);
  });

  test("a teacher free at that time is not", () => {
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    assert.equal(overlaps("siti", "s1"), false);
  });

  test("back-to-back is not an overlap", () => {
    // Touching at the edges is the normal LQK roster, not a clash.
    makeShift("s1", "aisyah", SOON, SOON_END);
    const after = new Date(new Date(SOON_END).getTime() + 2 * 3600 * 1000).toISOString();
    makeShift("s2", "huda", SOON_END, after);
    offer("s1", "aisyah");
    assert.equal(overlaps("huda", "s1"), false);
  });

  test("a cancelled shift of theirs is not a clash", () => {
    makeShift("s1", "aisyah");
    makeShift("s2", "huda", SOON, SOON_END, "cancelled");
    offer("s1", "aisyah");
    assert.equal(overlaps("huda", "s1"), false);
  });

  test("a partial overlap still counts", () => {
    makeShift("s1", "aisyah", SOON, SOON_END);
    const mid = new Date(new Date(SOON).getTime() + 3600 * 1000).toISOString();
    const later = new Date(new Date(SOON_END).getTime() + 3600 * 1000).toISOString();
    makeShift("s2", "huda", mid, later);
    offer("s1", "aisyah");
    assert.equal(overlaps("huda", "s1"), true);
  });
});

describe("the board", () => {
  function board(uid) {
    return db
      .prepare(
        `SELECT id FROM shifts
         WHERE offered_at IS NOT NULL AND status = 'planned' AND starts_at > ? AND teacher_id != ?
         ORDER BY starts_at ASC`
      )
      .all(new Date().toISOString(), uid)
      .map((r) => r.id);
  }

  test("shows an offered future shift to everybody else", () => {
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    assert.deepEqual(board("huda"), ["s1"]);
  });

  test("but never your own — the one you just gave away is not an opportunity", () => {
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    assert.deepEqual(board("aisyah"), []);
  });

  test("an offer nobody took before it started drops off", () => {
    // That is an uncovered shift, and it belongs on the IT Head's list rather
    // than sitting at the top of the board forever.
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    makeShift("s1", "aisyah", past, new Date(Date.now() + 3600 * 1000).toISOString());
    offer("s1", "aisyah");
    assert.deepEqual(board("huda"), []);
  });

  test("a taken shift leaves the board for everyone", () => {
    makeShift("s1", "aisyah");
    offer("s1", "aisyah");
    take("s1", "huda");
    assert.deepEqual(board("siti"), []);
    assert.deepEqual(board("zafirah"), []);
  });
});

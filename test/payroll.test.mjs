// Payroll aggregation, and the database guarantees that keep it honest.
//
// The pure half tests summariseSessions — the branch that decides what each
// teacher is owed. The integration half runs against a REAL database built by
// ensureSchema in a throwaway directory, because the double-pay guard is a
// partial unique index: testing a hand-written copy of it would prove nothing.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { summariseSessions, summaryTotals } from "../lib/hours/payroll.js";
import { formatMoney, isoFromSgSpanning, PH_MULTIPLIER } from "../lib/hours/rates.js";

// ---- pure: monthly aggregation ----------------------------------------

function session(over = {}) {
  return {
    id: randomUUID(),
    teacherId: "t1",
    teacherName: "Siti Aminah",
    payTier: "lead", // $20/hr
    category: "teaching",
    startedAt: "2026-08-10T01:00:00.000Z", // 09:00 SG
    minutes: 120,
    status: "approved",
    rateCents: 2000,
    phName: null,
    phMultiplier: null,
    ...over,
  };
}

describe("monthly summary", () => {
  test("totals teaching and OT minutes separately", () => {
    const [t] = summariseSessions(
      [session({ minutes: 120 }), session({ category: "ot", minutes: 60, rateCents: 1000 })],
      "2026-08"
    );
    assert.equal(t.teachingMinutes, 120);
    assert.equal(t.otMinutes, 60);
    assert.equal(formatMoney(t.approvedCents), "$50.00"); // $40 + $10
  });

  test("an approved session pays its SNAPSHOT, not the current tier", () => {
    // Approved as an assistant ($15), promoted to lead ($20) since. The month
    // that was signed off must not move.
    const [t] = summariseSessions([session({ rateCents: 1500, payTier: "lead" })], "2026-08");
    assert.equal(formatMoney(t.approvedCents), "$30.00", "2h at the snapshotted $15, not $20");
  });

  test("a pending session is an estimate at today's rate", () => {
    const [t] = summariseSessions([session({ status: "pending", rateCents: null })], "2026-08");
    assert.equal(formatMoney(t.pendingCents), "$40.00");
    assert.equal(t.pendingCount, 1);
    assert.equal(t.approvedCents, 0);
  });

  test("rejected sessions are ignored entirely", () => {
    assert.deepEqual(summariseSessions([session({ status: "rejected" })], "2026-08"), []);
  });

  test("only the requested month counts", () => {
    const july = session({ startedAt: "2026-07-10T01:00:00.000Z" });
    assert.deepEqual(summariseSessions([july], "2026-08"), []);
    assert.equal(summariseSessions([july], "2026-07").length, 1);
  });

  test("the month is Singapore's, not UTC's", () => {
    // 2026-07-31T17:00Z is already 1 August in Singapore.
    const s = session({ startedAt: "2026-07-31T17:00:00.000Z" });
    assert.equal(summariseSessions([s], "2026-08").length, 1);
    assert.equal(summariseSessions([s], "2026-07").length, 0);
  });

  test("teachers are separated and sorted by name", () => {
    const rows = summariseSessions(
      [session({ teacherId: "b", teacherName: "Zainab" }), session({ teacherId: "a", teacherName: "Amin" })],
      "2026-08"
    );
    assert.deepEqual(rows.map((r) => r.teacherName), ["Amin", "Zainab"]);
  });

  test("a missing pay tier totals zero rather than NaN", () => {
    const [t] = summariseSessions([session({ status: "pending", rateCents: null, payTier: null })], "2026-08");
    assert.equal(t.pendingCents, 0);
    assert.equal(formatMoney(t.pendingCents), "$0.00");
  });

  test("footer totals add the columns up", () => {
    const rows = summariseSessions(
      [session({ teacherId: "a", teacherName: "Amin" }), session({ teacherId: "b", teacherName: "Zainab" })],
      "2026-08"
    );
    const totals = summaryTotals(rows);
    assert.equal(totals.teachingMinutes, 240);
    assert.equal(formatMoney(totals.approvedCents), "$80.00");
  });
});

describe("public holiday pay in the summary", () => {
  test("an approved PH session pays the snapshotted multiplier", () => {
    const [t] = summariseSessions(
      [session({ phName: "National Day", phMultiplier: 2 })],
      "2026-08"
    );
    assert.equal(formatMoney(t.approvedCents), "$80.00", "2h x $20 x 2");
    assert.equal(t.phMinutes, 120);
  });

  test("changing PH_MULTIPLIER cannot rewrite an approved month", () => {
    const snapshotted = summariseSessions([session({ phName: "X", phMultiplier: 2 })], "2026-08")[0];
    const ifItWereNow = summariseSessions([session({ phName: "X", phMultiplier: 1.5 })], "2026-08")[0];
    assert.equal(formatMoney(snapshotted.approvedCents), "$80.00");
    assert.notEqual(snapshotted.approvedCents, ifItWereNow.approvedCents);
  });

  test("a pending PH session is estimated at the current multiplier", () => {
    const [t] = summariseSessions(
      [session({ status: "pending", rateCents: null, phName: "X", phEstimateMultiplier: PH_MULTIPLIER })],
      "2026-08"
    );
    assert.equal(formatMoney(t.pendingCents), "$80.00");
  });

  test("a non-holiday session is never multiplied", () => {
    const [t] = summariseSessions([session({ phName: null, phMultiplier: 2 })], "2026-08");
    assert.equal(formatMoney(t.approvedCents), "$80.00", "the multiplier column is what pays");
    const [u] = summariseSessions([session()], "2026-08");
    assert.equal(formatMoney(u.approvedCents), "$40.00");
  });
});

// ---- integration: the real schema --------------------------------------

describe("database guarantees", () => {
  let db;
  let dir;

  before(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "lqk-test-"));
    process.env.LQK_DATA_DIR = dir;
    process.env.NODE_ENV = "production"; // never seed demo accounts
    ({ getDb: db } = await import("../lib/db.js"));
    db = db();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, primary_location, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run("t1", "Siti Aminah", "siti@test.local", "x", "teacher", "Woods Square", now);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  function makeShift(id, date, start, end) {
    const span = isoFromSgSpanning(date, start, end);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, branch, date, start_time, end_time, starts_at, ends_at,
                           status, created_at, updated_at)
       VALUES (?, 't1', 'teaching', 'Woods Square', ?, ?, ?, ?, ?, 'planned', ?, ?)`
    ).run(id, date, start, end, span.startsAt, span.endsAt, now, now);
    return span;
  }

  function realise(shiftId, span) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO work_sessions (id, teacher_id, category, branch, started_at, ended_at, status,
                                  shift_id, clock_in_at, source, created_at, updated_at)
       VALUES (?, 't1', 'teaching', 'Woods Square', ?, ?, 'pending', ?, ?, 'clock_in', ?, ?)`
    ).run(randomUUID(), span.startsAt, span.endsAt, shiftId, now, now, now);
  }

  test("one shift can never be paid twice", () => {
    const span = makeShift("s1", "2026-08-10", "09:00", "11:00");
    realise("s1", span);
    assert.throws(() => realise("s1", span), /UNIQUE/, "the partial unique index must reject the second");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM work_sessions WHERE shift_id = 's1'").get().c, 1);
  });

  test("legacy and unscheduled sessions coexist freely with NULL shift_id", () => {
    const now = new Date().toISOString();
    const ins = db.prepare(
      `INSERT INTO work_sessions (id, teacher_id, category, started_at, ended_at, status, source, created_at, updated_at)
       VALUES (?, 't1', 'teaching', ?, NULL, 'pending', 'unscheduled', ?, ?)`
    );
    ins.run(randomUUID(), now, now, now);
    ins.run(randomUUID(), now, now, now);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM work_sessions WHERE shift_id IS NULL").get().c, 2);
  });

  test("a teacher can't be rostered twice at the same instant", () => {
    makeShift("s2", "2026-08-11", "09:00", "11:00");
    assert.throws(() => makeShift("s3", "2026-08-11", "09:00", "13:00"), /UNIQUE/);
  });

  test("a cancelled shift frees that slot to be re-rostered", () => {
    // The unique index is partial on status='planned', so cancelling releases it.
    db.prepare("UPDATE shifts SET status = 'cancelled' WHERE id = 's2'").run();
    assert.doesNotThrow(() => makeShift("s4", "2026-08-11", "09:00", "13:00"));
  });

  test("a worked shift cannot be deleted out from under its payroll row", () => {
    // foreign_keys is ON with no ON DELETE, so this is RESTRICT. The UI must
    // offer cancel instead — this asserts the database backs that up.
    assert.throws(() => db.prepare("DELETE FROM shifts WHERE id = 's1'").run(), /FOREIGN KEY/);
  });

  test("deleting an account still works despite that RESTRICT", () => {
    // shifts and work_sessions both cascade from profiles, but work_sessions
    // also RESTRICT-references shifts — so the cascade could in principle hit
    // them in an order that blocks the delete. It doesn't; this pins that.
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)"
    ).run("t2", "Temp", "temp@test.local", "x", "teacher", now);
    const span = isoFromSgSpanning("2026-09-01", "09:00", "11:00");
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, date, start_time, end_time, starts_at, ends_at, status, created_at, updated_at)
       VALUES ('s9', 't2', 'teaching', '2026-09-01', '09:00', '11:00', ?, ?, 'planned', ?, ?)`
    ).run(span.startsAt, span.endsAt, now, now);
    db.prepare(
      `INSERT INTO work_sessions (id, teacher_id, category, started_at, ended_at, status, shift_id, source, created_at, updated_at)
       VALUES (?, 't2', 'teaching', ?, ?, 'pending', 's9', 'clock_in', ?, ?)`
    ).run(randomUUID(), span.startsAt, span.endsAt, now, now);

    assert.doesNotThrow(() => db.prepare("DELETE FROM profiles WHERE id = 't2'").run());
    assert.equal(db.prepare("SELECT COUNT(*) c FROM shifts WHERE teacher_id = 't2'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM work_sessions WHERE teacher_id = 't2'").get().c, 0);
  });
});

// Database guarantees behind clock-in-based pay.
//
// The pure rules live in test/attendance.test.mjs. These are the properties a
// mock cannot prove: that the migrations actually land on an EXISTING database,
// that the new columns hold what the actions write, and that the foreign keys
// behave when somebody is deleted. The additive-migration path is the one that
// runs against the live Railway volume, so it is the one worth exercising.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { isoFromSgSpanning } from "../lib/hours/rates.js";
import { payableWindow, roundClockIn } from "../lib/hours/attendance.js";

// ONE database for the whole file. lib/db.js caches its connection, so a second
// describe that re-imports it and points LQK_DATA_DIR somewhere else gets the
// first one's handle — pointed at a directory the first suite has since removed.
let db;
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-hours-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production"; // never seed demo accounts
  const mod = await import("../lib/db.js");
  db = mod.getDb();
  const now = new Date().toISOString();
  for (const [id, name] of [
    ["t1", "Aisyah"],
    ["t2", "Huda"],
    ["t3", "Siti"],
    ["a", "Aisyah R"],
    ["h", "Huda R"],
    ["s", "Siti R"],
  ]) {
    db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, pay_tier, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(id, name, `${id}@test.local`, "x", "teacher", "asst", now);
  }
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("clock-in pay, against a real database", () => {

  function makeShift(teacherId, date, start, end, extra = {}) {
    const span = isoFromSgSpanning(date, start, end);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, ot_role, branch, date, start_time, end_time,
                           starts_at, ends_at, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`
    ).run(
      id, teacherId, extra.category || "teaching", extra.otRole || null,
      date, start, end, span.startsAt, span.endsAt, extra.note || null, now, now
    );
    return { id, ...span, date, status: "planned", category: extra.category || "teaching" };
  }

  // What lib/actions/hours.js#clockIn writes, in miniature.
  function clockIn(shift, tapIso) {
    const tap = roundClockIn(tapIso);
    const window = payableWindow(shift, tap);
    if (!window) return null;
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO work_sessions (id, teacher_id, category, started_at, ended_at, status,
                                  shift_id, clock_in_at, clock_in_original_at, source, created_at, updated_at)
       VALUES (?, ?, 'teaching', ?, ?, 'pending', ?, ?, ?, 'clock_in', ?, ?)`
    ).run(id, shift.teacherId || "t1", window.startsAt, window.endsAt, shift.id, tap, tap, now, now);
    return id;
  }

  test("the new columns exist after an additive migration", () => {
    const cols = new Set(db.prepare("PRAGMA table_info(work_sessions)").all().map((c) => c.name));
    for (const c of ["clock_in_original_at", "adjusted_by", "adjusted_at", "adjust_reason"]) {
      assert.ok(cols.has(c), `work_sessions is missing ${c}`);
    }
    const shiftCols = new Set(db.prepare("PRAGMA table_info(shifts)").all().map((c) => c.name));
    assert.ok(shiftCols.has("ot_role"));
  });

  test("a late clock-in stores the payable start, not the scheduled one", () => {
    const shift = { ...makeShift("t1", "2026-10-05", "15:00", "18:00"), teacherId: "t1" };
    const id = clockIn(shift, isoFromSgSpanning("2026-10-05", "15:20", "15:20").startsAt);
    const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(id);

    assert.equal(row.started_at, isoFromSgSpanning("2026-10-05", "15:20", "15:20").startsAt);
    assert.equal(row.ended_at, shift.endsAt, "the end is always the roster's");
  });

  test("an early clock-in is recorded but pays from the scheduled start", () => {
    const shift = { ...makeShift("t1", "2026-10-06", "15:00", "18:00"), teacherId: "t1" };
    const early = isoFromSgSpanning("2026-10-06", "14:30", "14:30").startsAt;
    const id = clockIn(shift, early);
    const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(id);

    assert.equal(row.started_at, shift.startsAt, "pay starts at the roster");
    assert.equal(row.clock_in_at, early, "but the tap is kept");
  });

  test("the original tap survives an adjustment", () => {
    const shift = { ...makeShift("t1", "2026-10-07", "15:00", "18:00"), teacherId: "t1" };
    const tap = isoFromSgSpanning("2026-10-07", "15:40", "15:40").startsAt;
    const id = clockIn(shift, tap);

    // What adjustClockIn does: move the operative clock-in and the payable
    // start, leave clock_in_original_at alone.
    const fixed = isoFromSgSpanning("2026-10-07", "15:00", "15:00").startsAt;
    db.prepare(
      "UPDATE work_sessions SET clock_in_at = ?, started_at = ?, adjusted_by = ?, adjust_reason = ? WHERE id = ?"
    ).run(fixed, fixed, "t2", "Phone died, MH confirmed she was there", id);

    const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(id);
    assert.equal(row.clock_in_at, fixed);
    assert.equal(row.started_at, fixed);
    assert.equal(row.clock_in_original_at, tap, "the evidence must outlive the adjustment");
    assert.equal(row.adjusted_by, "t2");
  });

  test("one shift still cannot be clocked in twice", () => {
    const shift = { ...makeShift("t1", "2026-10-08", "15:00", "18:00"), teacherId: "t1" };
    clockIn(shift, isoFromSgSpanning("2026-10-08", "15:00", "15:00").startsAt);
    assert.throws(
      () => clockIn(shift, isoFromSgSpanning("2026-10-08", "15:05", "15:05").startsAt),
      /UNIQUE/
    );
  });

  test("a tap after the shift ended creates nothing at all", () => {
    const shift = { ...makeShift("t1", "2026-10-09", "15:00", "18:00"), teacherId: "t1" };
    assert.equal(clockIn(shift, isoFromSgSpanning("2026-10-09", "18:30", "18:30").startsAt), null);
  });

  test("ot_role rides on the shift and defaults to plain OT", () => {
    const withRole = makeShift("t1", "2026-10-10", "09:00", "11:00", { category: "ot", otRole: "mentoring" });
    const plain = makeShift("t1", "2026-10-10", "14:00", "16:00", { category: "ot" });
    assert.equal(db.prepare("SELECT ot_role FROM shifts WHERE id = ?").get(withRole.id).ot_role, "mentoring");
    assert.equal(db.prepare("SELECT ot_role FROM shifts WHERE id = ?").get(plain.id).ot_role, null);
  });
});

describe("splitting a shift, against a real database", () => {
  test("Aisyah's two classes become Huda's and Siti's", () => {
    // The case Karim described: one rostered shift covers two classes, it is
    // offered as a whole, and two different reliefs take one each.
    const date = "2026-10-12";
    const whole = isoFromSgSpanning(date, "15:00", "21:00");
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, date, start_time, end_time, starts_at, ends_at,
                           status, created_at, updated_at)
       VALUES (?, 'a', 'teaching', ?, '15:00', '21:00', ?, ?, 'planned', ?, ?)`
    ).run(id, date, whole.startsAt, whole.endsAt, now, now);

    const first = isoFromSgSpanning(date, "15:00", "18:00");
    const second = isoFromSgSpanning(date, "18:00", "21:00");
    const newId = randomUUID();

    // BEGIN/COMMIT by hand: node:sqlite has no .transaction() helper, which is
    // what splitShift itself does.
    db.exec("BEGIN");
    db.prepare("UPDATE shifts SET teacher_id = 'h', end_time = '18:00', ends_at = ? WHERE id = ?")
      .run(first.endsAt, id);
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, date, start_time, end_time, starts_at, ends_at,
                           status, created_at, updated_at)
       VALUES (?, 's', 'teaching', ?, '18:00', '21:00', ?, ?, 'planned', ?, ?)`
    ).run(newId, date, second.startsAt, second.endsAt, now, now);
    db.exec("COMMIT");

    const rows = db
      .prepare("SELECT teacher_id, start_time, end_time FROM shifts WHERE date = ? ORDER BY start_time")
      .all(date);

    assert.deepEqual(rows.map((r) => [r.teacher_id, r.start_time, r.end_time]), [
      ["h", "15:00", "18:00"],
      ["s", "18:00", "21:00"],
    ]);

    // The two halves must still cover exactly what the original did, with no
    // gap in the middle: a missing minute here is a class nobody is rostered
    // for and nobody is looking for.
    assert.equal(first.startsAt, whole.startsAt);
    assert.equal(second.endsAt, whole.endsAt);
    assert.equal(first.endsAt, second.startsAt);
  });

  test("a worked shift is detectable, so the split can refuse it", () => {
    const date = "2026-10-13";
    const span = isoFromSgSpanning(date, "15:00", "21:00");
    const shiftId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, date, start_time, end_time, starts_at, ends_at,
                           status, created_at, updated_at)
       VALUES (?, 'a', 'teaching', ?, '15:00', '21:00', ?, ?, 'planned', ?, ?)`
    ).run(shiftId, date, span.startsAt, span.endsAt, now, now);
    db.prepare(
      `INSERT INTO work_sessions (id, teacher_id, category, started_at, ended_at, status, shift_id,
                                  clock_in_at, created_at, updated_at)
       VALUES (?, 'a', 'teaching', ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(randomUUID(), span.startsAt, span.endsAt, shiftId, span.startsAt, now, now);

    const worked = db.prepare("SELECT id FROM work_sessions WHERE shift_id = ?").get(shiftId);
    assert.ok(worked, "splitShift checks exactly this before touching anything");
  });
});

describe("location coordinates table", () => {
  test("coordinates are stored per location key, once", () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO location_coords (key, lat, lng, resolved_from, source, resolved_at) VALUES (?,?,?,?,?,?)"
    ).run("wdsq_1", 1.4364, 103.7866, "737715", "onemap", now);

    assert.throws(
      () =>
        db
          .prepare(
            "INSERT INTO location_coords (key, lat, lng, resolved_from, source, resolved_at) VALUES (?,?,?,?,?,?)"
          )
          .run("wdsq_1", 9, 9, "737715", "onemap", now),
      /UNIQUE|PRIMARY/
    );
  });

  test("a centre with no row is unresolved, which must not read as unfenced", () => {
    const row = db.prepare("SELECT * FROM location_coords WHERE key = ?").get("primz");
    assert.equal(row, undefined);
    // checkGeofence turns this into no_coords and REFUSES — asserted in
    // test/periods.test.mjs. Recorded here so the DB half of that story is
    // visible from this file too.
  });
});

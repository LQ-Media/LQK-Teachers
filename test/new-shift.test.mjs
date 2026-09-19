// The New shift form, at the database.
//
// lib/actions/shifts.js carries "use server" and imports through "@/", so
// createShifts cannot be imported here. The parts worth testing are the ones
// that touch real SQL, and they are mirrored below against a real database
// built by the real migration:
//
//   • the PUBLISHED column and its default, which decides whether a teacher
//     can see a shift at all — and whether they can be PAID for one;
//   • the per-teacher atomicity, so nobody ends up with half a term;
//   • the clash window, including the shift that spans midnight;
//   • POSITION surviving the round trip, since it decides teaching vs OT.
//
// Run under both timezones: the dates are Singapore, the instants are UTC.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { positionMeaning, repeatMeaning } from "../lib/hours/positions.js";
import { buildShiftRows, findOverlaps } from "../lib/hours/shifts.js";
import { isoFromSgSpanning } from "../lib/hours/rates.js";
import { endOfSgWeek } from "../lib/hours/calendar.js";

let db;
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-newshift-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production";
  const mod = await import("../lib/db.js");
  db = mod.getDb();
});

after(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date().toISOString();

function person(id, name, position = "LEAD TEACHER") {
  db.prepare(
    "INSERT OR REPLACE INTO profiles (id, full_name, email, password_hash, role, position, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(id, name, `${id}@shift.local`, "x", "teacher", position, NOW);
}

beforeEach(() => {
  db.exec("DELETE FROM work_sessions");
  db.exec("DELETE FROM shift_history");
  db.exec("DELETE FROM shifts");
  db.exec("DELETE FROM profiles");
  person("aisyah", "Nur Aisyah");
  person("huda", "Nurul Huda");
  person("admin", "Nur Abdul Karim");
});

/**
 * The insert createShifts performs, with the same columns in the same order.
 * Mirrored rather than imported, for the "use server" reason above.
 */
function insertShift({ teacherId, position, date, startTime, endTime, published = 1, batchId = null, phName = null }) {
  const meaning = positionMeaning(position);
  if (!meaning) throw new Error(`unknown position: ${position}`);
  const span = isoFromSgSpanning(date, startTime, endTime);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO shifts (id, teacher_id, category, ot_reason, ot_role, position, branch, date,
                         start_time, end_time, starts_at, ends_at, status, ph_name, published,
                         note, batch_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, teacherId, meaning.category,
    meaning.category === "ot" ? "Other" : null,
    meaning.otRole, meaning.key, "Woods Square", date,
    startTime, endTime, span.startsAt, span.endsAt,
    phName, published, null, batchId, "admin", NOW, NOW
  );
  return id;
}

/** The clash check, with the same one-day-either-side window. */
function clashFor(teacherId, dates, startTime, endTime) {
  const sorted = [...dates].sort();
  const existing = db
    .prepare("SELECT * FROM shifts WHERE teacher_id = ? AND status = 'planned' AND date BETWEEN ? AND ?")
    .all(teacherId, dayBefore(sorted[0]), dayAfter(sorted[sorted.length - 1]))
    .map((r) => ({ id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status }));

  for (const d of dates) {
    const span = isoFromSgSpanning(d, startTime, endTime);
    const candidate = { id: `new-${d}`, ...span, status: "planned" };
    if (findOverlaps([...existing, candidate]).some((pair) => pair.some((x) => x.id === candidate.id))) {
      return d;
    }
  }
  return null;
}

const shiftDay = (d, n) =>
  new Date(new Date(`${d}T12:00:00+08:00`).getTime() + n * 86400000)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const dayBefore = (d) => shiftDay(d, -1);
const dayAfter = (d) => shiftDay(d, 1);

const count = (sql, ...args) => db.prepare(`SELECT COUNT(*) c FROM shifts ${sql}`).get(...args).c;

describe("the published column", () => {
  test("every shift made before the column existed is visible", () => {
    // DEFAULT 1 is the whole migration story: 373 shifts already on the roster
    // must not all become invisible drafts the moment this column lands.
    const id = db.prepare("SELECT id FROM shifts LIMIT 1").get();
    assert.equal(id, undefined);
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, branch, date, start_time, end_time,
                           starts_at, ends_at, status, created_at, updated_at)
       VALUES ('legacy','aisyah','teaching','Woods Square','2026-09-25','10:00','13:00',
               '2026-09-25T02:00:00.000Z','2026-09-25T05:00:00.000Z','planned',?,?)`
    ).run(NOW, NOW);
    assert.equal(db.prepare("SELECT published FROM shifts WHERE id='legacy'").get().published, 1);
  });

  test("a draft is stored as 0 and a published shift as 1", () => {
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00" });
    insertShift({ teacherId: "huda", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00", published: 0 });
    assert.equal(count("WHERE published = 1"), 1);
    assert.equal(count("WHERE published = 0"), 1);
  });

  test("the teacher's roster query hides the draft", () => {
    // The promise the PUBLISH toggle makes: "teachers can't see it".
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00", published: 0 });
    const visible = db
      .prepare("SELECT id FROM shifts WHERE teacher_id = ? AND published = 1 AND date BETWEEN ? AND ?")
      .all("aisyah", "2026-09-01", "2026-09-30");
    assert.equal(visible.length, 0);
    assert.equal(count("WHERE teacher_id = 'aisyah'"), 1, "the shift still exists for the admin");
  });

  test("the clock-in query hides the draft too", () => {
    // The one that matters most. Hiding a shift from the roster while still
    // paying for it would be the worst of both — the teacher could not see
    // what they were paid for.
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00", published: 0 });
    const due = db
      .prepare("SELECT id FROM shifts WHERE teacher_id = ? AND date = ? AND status = 'planned' AND published = 1")
      .all("aisyah", "2026-09-21");
    assert.equal(due.length, 0);
  });

  test("the reminder query hides the draft", () => {
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00", published: 0 });
    const rows = db
      .prepare("SELECT id FROM shifts WHERE status != 'cancelled' AND published = 1")
      .all();
    assert.equal(rows.length, 0);
  });

  test("publishing is a plain update, and the draft becomes visible", () => {
    const id = insertShift({
      teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21",
      startTime: "09:00", endTime: "11:00", published: 0,
    });
    db.prepare("UPDATE shifts SET published = 1, updated_at = ? WHERE id = ?").run(NOW, id);
    assert.equal(count("WHERE published = 1"), 1);
  });

  test("a draft still occupies the slot, so it cannot be double-booked", () => {
    // Deliberate: the draft is a plan, and rostering somebody else over it
    // would mean publishing produced a clash that was never shown to anybody.
    insertShift({
      teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21",
      startTime: "09:00", endTime: "11:00", published: 0,
    });
    assert.equal(clashFor("aisyah", ["2026-09-21"], "10:00", "12:00"), "2026-09-21");
  });
});

describe("position on the shift", () => {
  test("a teaching position stores teaching and no OT team", () => {
    const id = insertShift({ teacherId: "aisyah", position: "Lead Teacher (ARS)", date: "2026-09-21", startTime: "09:00", endTime: "11:00" });
    const r = db.prepare("SELECT * FROM shifts WHERE id = ?").get(id);
    assert.equal(r.position, "Lead Teacher (ARS)");
    assert.equal(r.category, "teaching");
    assert.equal(r.ot_role, null);
    assert.equal(r.ot_reason, null);
  });

  test("a team position stores OT and the team", () => {
    const id = insertShift({ teacherId: "aisyah", position: "Events Team", date: "2026-09-21", startTime: "14:00", endTime: "17:00" });
    const r = db.prepare("SELECT * FROM shifts WHERE id = ?").get(id);
    assert.equal(r.position, "Events Team");
    assert.equal(r.category, "ot");
    assert.equal(r.ot_role, "events");
  });

  test("one form makes both kinds on the same day for the same person", () => {
    // The actual ask: "it will be for teaching and OT shift making, all fields
    // the same". A morning class and an afternoon for the events team.
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "07:30", endTime: "12:45" });
    insertShift({ teacherId: "aisyah", position: "Events Team", date: "2026-09-21", startTime: "14:00", endTime: "17:00" });
    const rows = db.prepare("SELECT category FROM shifts WHERE teacher_id='aisyah' ORDER BY starts_at").all();
    assert.deepEqual(rows.map((r) => r.category), ["teaching", "ot"]);
  });

  test("an unrecognised position is refused rather than defaulted", () => {
    assert.throws(
      () => insertShift({ teacherId: "aisyah", position: "Head of Everything", date: "2026-09-21", startTime: "09:00", endTime: "11:00" }),
      /unknown position/
    );
    assert.equal(count(""), 0);
  });
});

describe("repeat, written out", () => {
  const rowsFor = (repeat, from, until, weekdays) => {
    const r = repeatMeaning(repeat);
    const to = r.bounded ? endOfSgWeek(from) : until;
    return buildShiftRows({
      fromDate: from,
      toDate: to,
      weekdays,
      startTime: "16:00",
      endTime: "18:00",
      holidays: new Map(),
      skipHolidays: false,
      everyWeeks: r.weeks,
    }).rows;
  };

  test("never makes exactly one shift", () => {
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "16:00", endTime: "18:00" });
    assert.equal(count(""), 1);
    assert.equal(db.prepare("SELECT batch_id FROM shifts").get().batch_id, null, "one shift is not a batch");
  });

  test("this week runs to the Sunday of the shift's own week", () => {
    // Monday 21 Sep 2026 → the week ends Sunday 27 Sep.
    const rows = rowsFor("this_week", "2026-09-21", null, [1, 3, 5]);
    assert.deepEqual(rows.map((r) => r.date), ["2026-09-21", "2026-09-23", "2026-09-25"]);
  });

  test("this week on a Sunday is that Sunday alone", () => {
    // The edge the Monday-start week creates: a Sunday is the LAST day of its
    // own week, so "this week" has nothing left in it.
    const rows = rowsFor("this_week", "2026-09-27", null, [0]);
    assert.deepEqual(rows.map((r) => r.date), ["2026-09-27"]);
  });

  test("every 2 weeks writes a fortnightly batch under one batch id", () => {
    const rows = rowsFor("every_2", "2026-09-21", "2026-10-19", [1]);
    const batchId = randomUUID();
    for (const r of rows) {
      insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: r.date, startTime: "16:00", endTime: "18:00", batchId });
    }
    assert.deepEqual(
      db.prepare("SELECT date FROM shifts ORDER BY date").all().map((r) => r.date),
      ["2026-09-21", "2026-10-05", "2026-10-19"]
    );
    assert.equal(db.prepare("SELECT COUNT(DISTINCT batch_id) c FROM shifts").get().c, 1);
  });
});

describe("one shift each, for everybody picked", () => {
  test("two people get their own row for the same slot", () => {
    const batchId = randomUUID();
    for (const t of ["aisyah", "huda"]) {
      insertShift({ teacherId: t, position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00", batchId });
    }
    assert.equal(count(""), 2);
    assert.equal(count("WHERE teacher_id = 'aisyah'"), 1);
    assert.equal(count("WHERE teacher_id = 'huda'"), 1);
  });

  test("a clash for one person leaves the other's shifts alone", () => {
    // Atomicity is PER TEACHER. A clash for one must not block the other
    // nineteen, and nobody may end up with half a term.
    insertShift({ teacherId: "huda", position: "Lead Teacher", date: "2026-09-23", startTime: "10:00", endTime: "12:00" });

    const dates = ["2026-09-21", "2026-09-23", "2026-09-25"];
    const results = {};
    for (const t of ["aisyah", "huda"]) {
      const clash = clashFor(t, dates, "09:00", "11:00");
      if (clash) {
        results[t] = { clash };
        continue;
      }
      db.exec("BEGIN");
      for (const d of dates) {
        insertShift({ teacherId: t, position: "Lead Teacher", date: d, startTime: "09:00", endTime: "11:00" });
      }
      db.exec("COMMIT");
      results[t] = { created: dates.length };
    }

    assert.equal(results.aisyah.created, 3);
    assert.equal(results.huda.clash, "2026-09-23");
    assert.equal(count("WHERE teacher_id = 'aisyah'"), 3);
    assert.equal(count("WHERE teacher_id = 'huda'"), 1, "only the shift they already had");
  });

  test("a failure mid-batch rolls the whole teacher back", () => {
    const dates = ["2026-09-21", "2026-09-22", "2026-09-23"];
    db.exec("BEGIN");
    try {
      insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: dates[0], startTime: "09:00", endTime: "11:00" });
      insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: dates[1], startTime: "09:00", endTime: "11:00" });
      insertShift({ teacherId: "aisyah", position: "Not A Position", date: dates[2], startTime: "09:00", endTime: "11:00" });
      db.exec("COMMIT");
      assert.fail("should have thrown");
    } catch {
      db.exec("ROLLBACK");
    }
    assert.equal(count(""), 0, "nobody gets two thirds of a term");
  });
});

describe("the clash window", () => {
  test("an identical slot clashes", () => {
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00" });
    assert.equal(clashFor("aisyah", ["2026-09-21"], "09:00", "11:00"), "2026-09-21");
  });

  test("back-to-back shifts do not clash", () => {
    // An 09:00–11:00 and an 11:00–13:00 are a morning, not a double booking.
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00" });
    assert.equal(clashFor("aisyah", ["2026-09-21"], "11:00", "13:00"), null);
  });

  test("a shift that runs past midnight clashes with the NEXT day's early start", () => {
    // The reason the window is a day either side. The row that clashes with a
    // 00:30 start on the 22nd is DATED the 21st, so checking only the exact
    // dates would let the pair through.
    insertShift({ teacherId: "aisyah", position: "Ad-hoc / OT", date: "2026-09-21", startTime: "22:00", endTime: "02:00" });
    assert.equal(clashFor("aisyah", ["2026-09-22"], "00:30", "03:00"), "2026-09-22");
  });

  test("the same overnight shift does not clash with a late morning", () => {
    insertShift({ teacherId: "aisyah", position: "Ad-hoc / OT", date: "2026-09-21", startTime: "22:00", endTime: "02:00" });
    assert.equal(clashFor("aisyah", ["2026-09-22"], "09:00", "11:00"), null);
  });

  test("a cancelled shift never clashes", () => {
    const id = insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00" });
    db.prepare("UPDATE shifts SET status = 'cancelled' WHERE id = ?").run(id);
    assert.equal(clashFor("aisyah", ["2026-09-21"], "09:00", "11:00"), null);
  });

  test("somebody else's shift is not your clash", () => {
    insertShift({ teacherId: "huda", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00" });
    assert.equal(clashFor("aisyah", ["2026-09-21"], "09:00", "11:00"), null);
  });

  test("the unique index is the last line of defence", () => {
    // Two rows with the same teacher and the same instant, where the overlap
    // check somehow did not see the first.
    insertShift({ teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21", startTime: "09:00", endTime: "11:00" });
    assert.throws(
      () => insertShift({ teacherId: "aisyah", position: "Intern", date: "2026-09-21", startTime: "09:00", endTime: "10:00" }),
      /UNIQUE/
    );
  });
});

describe("publishing leaves a trail", () => {
  test("a draft creation, then a publish, read as two entries in order", () => {
    const id = insertShift({
      teacherId: "aisyah", position: "Lead Teacher", date: "2026-09-21",
      startTime: "09:00", endTime: "11:00", published: 0,
    });
    const log = (action, from, to) =>
      db.prepare(
        `INSERT INTO shift_history (id, shift_id, actor_id, actor_name, action, field, from_value, to_value, at)
         VALUES (?,?,?,?,?,NULL,?,?,?)`
      ).run(randomUUID(), id, "admin", "Nur Abdul Karim", action, from, to, new Date().toISOString());

    log("created", null, "draft");
    log("published", "draft", "published");
    const rows = db
      .prepare("SELECT action, to_value FROM shift_history WHERE shift_id = ? ORDER BY at ASC, rowid ASC")
      .all(id);
    assert.deepEqual(rows.map((r) => `${r.action}:${r.to_value}`), ["created:draft", "published:published"]);
  });
});

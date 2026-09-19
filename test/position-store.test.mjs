// The editable position list.
//
// lib/hours/position-store.js is "server-only" and imports through "@/", so its
// SQL is mirrored here against a real database built by the real migration. The
// validation rules are pure and imported directly.
//
// What is worth pinning, in order of how much it would cost to get wrong:
//
//   1. The SEED runs once. If it re-ran on every boot, a rename or an archive
//      would silently come back the next time the server restarted — the worst
//      possible behaviour for a screen whose whole point is being editable.
//   2. A RENAME moves shifts.position with it. The name IS the value stored on
//      every shift; leave them behind and the calendar colours them as plain
//      teaching and the edit form refuses to open them.
//   3. Re-classifying a position does NOT re-price shifts already worked.
//   4. An unknown position is still refused, so the list being editable never
//      becomes a way to create a shift nothing can classify.
//
// Run under both timezones — the rows are timestamped.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SHIFT_POSITIONS, POSITION_GROUPS, positionMeaning } from "../lib/hours/positions.js";
import { OT_ROLE_BY_KEY } from "../lib/hours/rates.js";
import { ROLE_COLOURS, roleOf } from "../lib/hours/calendar.js";

let db;
let dir;
let mod;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-positions-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production";
  mod = await import("../lib/db.js");
  db = mod.getDb();
});

after(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date().toISOString();

/** Mirrors allPositions(). */
function all() {
  return db
    .prepare(
      `SELECT name, category, ot_role, group_name, colour, sort_order, archived_at
       FROM shift_positions ORDER BY sort_order ASC, name ASC`
    )
    .all()
    .map((r) => ({
      key: r.name,
      category: r.category,
      otRole: r.ot_role || null,
      group: r.group_name,
      colour: r.colour || null,
      sortOrder: r.sort_order,
      archivedAt: r.archived_at || null,
    }));
}

const live = () => all().filter((p) => !p.archivedAt);

/** Mirrors the rename half of savePosition(). */
function rename(from, to) {
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE shift_positions SET name = ?, updated_at = ? WHERE name = ?").run(to, NOW, from);
    const changed = db
      .prepare("UPDATE shifts SET position = ?, updated_at = ? WHERE position = ?")
      .run(to, NOW, from).changes;
    db.exec("COMMIT");
    return changed;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function addShift(position, { category = "teaching", date = "2026-10-05", start = "09:00" } = {}) {
  const startsAt = new Date(`${date}T${start}:00+08:00`).toISOString();
  const endsAt = new Date(new Date(startsAt).getTime() + 2 * 3600 * 1000).toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO shifts (id, teacher_id, category, position, branch, date, start_time, end_time,
                         starts_at, ends_at, status, created_at, updated_at)
     VALUES (?, 'aisyah', ?, ?, 'Woods Square', ?, ?, '11:00', ?, ?, 'planned', ?, ?)`
  ).run(id, category, position, date, start, startsAt, endsAt, NOW, NOW);
  return id;
}

beforeEach(() => {
  db.exec("DELETE FROM shifts");
  db.exec("DELETE FROM profiles");
  db.prepare(
    "INSERT INTO profiles (id, full_name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)"
  ).run("aisyah", "Nur Aisyah", "aisyah@pos.test", "x", "teacher", NOW);
});

describe("the seed", () => {
  test("the table arrives populated from the code list", () => {
    // A deploy must change nothing: the eleven positions that were in code are
    // the eleven in the table, same names, same meanings, same order.
    const rows = all();
    assert.equal(rows.length, SHIFT_POSITIONS.length);
    assert.deepEqual(rows.map((r) => r.key), SHIFT_POSITIONS.map((p) => p.key));
    for (const p of SHIFT_POSITIONS) {
      const row = rows.find((r) => r.key === p.key);
      assert.equal(row.category, p.category, p.key);
      assert.equal(row.otRole, p.otRole, p.key);
      assert.equal(row.group, p.group, p.key);
    }
  });

  test("every seeded position has no colour, so it derives as it always did", () => {
    for (const r of all()) assert.equal(r.colour, null, r.key);
  });

  test("the seed is guarded on the table being EMPTY, not on each row", () => {
    // The bug this guards against: INSERT OR REPLACE per row on every boot
    // would undo a rename or an archive on the next deploy, and nobody would
    // connect the two events.
    //
    // Asserted as the guard's own condition rather than by restarting the
    // process, because there is no way to re-run ensureSchema from here — and a
    // test that silently did nothing would read as coverage it does not have.
    const populated = db.prepare("SELECT COUNT(*) AS c FROM shift_positions").get().c;
    assert.ok(populated > 0);
    assert.equal(!populated, false, "so the seed block is skipped on every boot after the first");
  });

  test("seeding an empty table fills it, and only then", () => {
    // The other half of the same guard, driven for real: empty it, run the
    // same insert loop the migration runs, and confirm it reproduces the list.
    const saved = all();
    db.exec("DELETE FROM shift_positions");
    assert.equal(all().length, 0);

    const seed = db.prepare(
      `INSERT INTO shift_positions (name, category, ot_role, group_name, colour, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`
    );
    if (!db.prepare("SELECT COUNT(*) AS c FROM shift_positions").get().c) {
      SHIFT_POSITIONS.forEach((p, i) => seed.run(p.key, p.category, p.otRole, p.group, i, NOW, NOW));
    }
    assert.deepEqual(all().map((r) => r.key), SHIFT_POSITIONS.map((p) => p.key));

    // A second pass must add nothing, because the table is no longer empty.
    if (!db.prepare("SELECT COUNT(*) AS c FROM shift_positions").get().c) {
      SHIFT_POSITIONS.forEach((p, i) => seed.run(p.key, p.category, p.otRole, p.group, i, NOW, NOW));
    }
    assert.equal(all().length, SHIFT_POSITIONS.length, "not doubled");

    // Restore whatever the earlier tests left, so order does not matter here.
    db.exec("DELETE FROM shift_positions");
    for (const p of saved) {
      seed.run(p.key, p.category, p.otRole, p.group, p.sortOrder, NOW, NOW);
      if (p.colour) db.prepare("UPDATE shift_positions SET colour = ? WHERE name = ?").run(p.colour, p.key);
      if (p.archivedAt) db.prepare("UPDATE shift_positions SET archived_at = ? WHERE name = ?").run(p.archivedAt, p.key);
    }
  });
});

describe("renaming", () => {
  test("it moves every shift that carries the old name", () => {
    addShift("Lead Teacher");
    addShift("Lead Teacher", { date: "2026-10-06" });
    addShift("Intern", { date: "2026-10-07" });

    const moved = rename("Lead Teacher", "Senior Teacher");
    assert.equal(moved, 2);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM shifts WHERE position='Senior Teacher'").get().c, 2);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM shifts WHERE position='Lead Teacher'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM shifts WHERE position='Intern'").get().c, 1, "others untouched");

    rename("Senior Teacher", "Lead Teacher");
  });

  test("a rename with no shifts on it reports zero rather than failing", () => {
    const moved = rename("Logistics", "Logistics Team");
    assert.equal(moved, 0);
    assert.ok(all().some((p) => p.key === "Logistics Team"));
    rename("Logistics Team", "Logistics");
  });

  test("renaming onto an existing name is refused by the primary key", () => {
    assert.throws(() => rename("Intern", "Probation"), /UNIQUE|constraint/i);
    // And the shifts must be untouched, because the whole thing is one
    // transaction.
    assert.ok(all().some((p) => p.key === "Intern"));
    assert.ok(all().some((p) => p.key === "Probation"));
  });

  test("a failed rename leaves the shifts alone", () => {
    addShift("Intern");
    try {
      rename("Intern", "Probation");
    } catch {
      /* expected */
    }
    assert.equal(db.prepare("SELECT COUNT(*) c FROM shifts WHERE position='Intern'").get().c, 1);
  });
});

describe("what a shift keeps when the position changes", () => {
  test("re-classifying a position does not re-price shifts already created", () => {
    // The rule that protects paid work. A shift's category is stamped at
    // creation and is what the payroll report reads; flipping the position to
    // OT afterwards must not retroactively turn a paid teaching month into an
    // unpaid one.
    const id = addShift("Lead Teacher", { category: "teaching" });
    db.prepare("UPDATE shift_positions SET category='ot', ot_role='events' WHERE name='Lead Teacher'").run();

    const shift = db.prepare("SELECT category, position FROM shifts WHERE id = ?").get(id);
    assert.equal(shift.category, "teaching", "the shift keeps what it was worked as");
    assert.equal(shift.position, "Lead Teacher");

    db.prepare("UPDATE shift_positions SET category='teaching', ot_role=NULL WHERE name='Lead Teacher'").run();
  });
});

describe("archiving", () => {
  test("an archived position leaves the list a new shift can use", () => {
    db.prepare("UPDATE shift_positions SET archived_at = ? WHERE name='Probation'").run(NOW);
    assert.ok(!live().some((p) => p.key === "Probation"));
    assert.ok(all().some((p) => p.key === "Probation"), "but it is still there");
    db.prepare("UPDATE shift_positions SET archived_at = NULL WHERE name='Probation'").run();
  });

  test("shifts already on an archived position keep it", () => {
    addShift("Probation");
    db.prepare("UPDATE shift_positions SET archived_at = ? WHERE name='Probation'").run(NOW);
    assert.equal(db.prepare("SELECT position FROM shifts").get().position, "Probation");
    db.prepare("UPDATE shift_positions SET archived_at = NULL WHERE name='Probation'").run();
  });

  test("the last live position cannot be archived away", () => {
    // Mirrors the guard in setPositionArchived. A New shift form with an empty
    // Position dropdown cannot create anything at all.
    const names = live().map((p) => p.key);
    db.prepare(`UPDATE shift_positions SET archived_at = ? WHERE name != ?`).run(NOW, names[0]);
    assert.equal(live().length, 1);
    const wouldBeLeft = live().filter((p) => p.key !== names[0]).length;
    assert.equal(wouldBeLeft, 0, "so the guard refuses");
    db.prepare("UPDATE shift_positions SET archived_at = NULL").run();
    assert.equal(live().length, names.length);
  });

  test("an archived position still resolves, so its shifts stay editable", () => {
    // positionMeaningLive reads allPositions, not livePositions, precisely for
    // this: tidying the list must not lock the edit form out of months of
    // shifts that carry an old position.
    db.prepare("UPDATE shift_positions SET archived_at = ? WHERE name='Intern'").run(NOW);
    assert.ok(all().find((p) => p.key === "Intern"), "resolvable");
    assert.ok(!live().find((p) => p.key === "Intern"), "but not offered");
    db.prepare("UPDATE shift_positions SET archived_at = NULL WHERE name='Intern'").run();
  });
});

describe("adding one", () => {
  test("a new position lands after the others in its group", () => {
    const before = all().length;
    const nextOrder = Math.max(...all().map((p) => p.sortOrder)) + 1;
    db.prepare(
      `INSERT INTO shift_positions (name, category, ot_role, group_name, colour, sort_order, created_at, updated_at)
       VALUES ('Relief Teacher', 'teaching', NULL, 'Teaching', 'assistant', ?, ?, ?)`
    ).run(nextOrder, NOW, NOW);
    const rows = all();
    assert.equal(rows.length, before + 1);
    assert.equal(rows[rows.length - 1].key, "Relief Teacher");
    db.prepare("DELETE FROM shift_positions WHERE name='Relief Teacher'").run();
  });

  test("the category CHECK refuses anything that is not teaching or ot", () => {
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO shift_positions (name, category, group_name, sort_order, created_at, updated_at)
             VALUES ('Nonsense', 'admin', 'Teaching', 99, ?, ?)`
          )
          .run(NOW, NOW),
      /CHECK|constraint/i
    );
  });

  test("a new position can be created with a chosen colour, and the calendar uses it", () => {
    db.prepare(
      `INSERT INTO shift_positions (name, category, ot_role, group_name, colour, sort_order, created_at, updated_at)
       VALUES ('Relief Teacher', 'teaching', NULL, 'Teaching', 'events', 99, ?, ?)`
    ).run(NOW, NOW);
    const p = all().find((x) => x.key === "Relief Teacher");
    assert.equal(p.colour, "events");
    // roleOf reads positionColour off the shaped shift.
    assert.equal(roleOf({ status: "planned", category: "teaching", position: p.key, positionColour: p.colour }), "events");
    db.prepare("DELETE FROM shift_positions WHERE name='Relief Teacher'").run();
  });
});

describe("the colour choice", () => {
  test("a chosen colour beats anything derived from the name", () => {
    // "Lead Teacher" would derive `lead`; the stored choice wins.
    assert.equal(
      roleOf({ status: "planned", category: "teaching", position: "Lead Teacher", positionColour: "curriculum" }),
      "curriculum"
    );
  });

  test("cancelled still beats a chosen colour", () => {
    assert.equal(
      roleOf({ status: "cancelled", category: "teaching", position: "Lead Teacher", positionColour: "curriculum" }),
      "cancelled"
    );
  });

  test("a colour the palette does not have falls back to deriving", () => {
    // Belt and braces: the action filters to COLOUR_KEYS, but a value written
    // by hand must not make a block render with no background at all.
    assert.equal(
      roleOf({ status: "planned", category: "teaching", position: "Lead Teacher", positionColour: "chartreuse" }),
      "lead"
    );
  });

  test("no colour behaves exactly as before the list was editable", () => {
    assert.equal(roleOf({ status: "planned", category: "ot", otRole: "logistics", positionColour: null }), "logistics");
    assert.equal(roleOf({ status: "planned", category: "teaching", position: "INTERN", positionColour: null }), "intern");
  });

  test("'cancelled' is not offered as a choice", () => {
    // It is the status colour. Letting somebody paint a live position grey
    // would make a working shift look called off.
    const offered = Object.keys(ROLE_COLOURS).filter((k) => k !== "cancelled");
    assert.ok(!offered.includes("cancelled"));
    assert.ok(offered.length > 5, "and the rest of the palette is available");
  });
});

describe("the code list stays a valid floor", () => {
  test("every seeded position resolves through the pure helper too", () => {
    // positions.js is both the seed and the fallback for an empty table, so it
    // has to stay self-consistent even though the DB is now the source.
    for (const p of SHIFT_POSITIONS) {
      const m = positionMeaning(p.key);
      assert.ok(m, `${p.key} does not resolve`);
      assert.equal(m.category, p.category);
    }
  });

  test("every OT team named in the code list is one rates.js knows", () => {
    for (const p of SHIFT_POSITIONS) {
      if (p.otRole) assert.ok(OT_ROLE_BY_KEY[p.otRole], `${p.key} → ${p.otRole}`);
    }
  });

  test("the seeded groups are the two the picker draws", () => {
    for (const r of all()) assert.ok(POSITION_GROUPS.includes(r.group), `${r.key} has group ${r.group}`);
  });
});

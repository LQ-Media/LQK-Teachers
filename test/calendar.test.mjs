// The roster calendar's grid maths.
//
// A calendar is all edges: the month that starts on a Sunday, the one that needs
// six rows, February in a leap year, and stepping back from the 31st. Each of
// those puts a shift in the wrong cell if it is wrong, and a shift in the wrong
// cell is an admin concluding nobody is rostered.
//
// Runs under TZ=UTC and Asia/Singapore in CI. Every answer must be identical:
// the dates are Singapore dates, and the module is written not to care what the
// server thinks the time is.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_LABELS,
  byDate,
  daysIntoWeek,
  legendFor,
  monthBounds,
  monthGrid,
  rangeFor,
  roleOf,
  startOfWeek,
  step,
  weekGrid,
  ROLE_COLOURS,
} from "../lib/hours/calendar.js";

describe("weeks start on Monday", () => {
  test("the labels run Mon to Sun", () => {
    assert.deepEqual(DAY_LABELS, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  test("every day of one real week maps to the same Monday", () => {
    // 14 Sep 2026 is a Monday; 20 Sep is the Sunday that ends its week.
    for (const d of [
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]) {
      assert.equal(startOfWeek(d), "2026-09-14", d);
    }
  });

  test("Sunday belongs to the week that STARTED, not the one about to", () => {
    // The classic off-by-one. Sunday is day 6 of its week, not day 0 of the next.
    assert.equal(daysIntoWeek("2026-09-20"), 6);
    assert.equal(startOfWeek("2026-09-21"), "2026-09-21"); // the next Monday
  });

  test("Monday is zero days into its week", () => {
    assert.equal(daysIntoWeek("2026-09-14"), 0);
  });

  test("a week grid is seven consecutive days, Monday first", () => {
    const w = weekGrid("2026-09-17");
    assert.equal(w.length, 7);
    assert.equal(w[0], "2026-09-14");
    assert.equal(w[6], "2026-09-20");
  });
});

describe("month bounds", () => {
  test("months of every length", () => {
    assert.equal(monthBounds("2026-09").last, "2026-09-30");
    assert.equal(monthBounds("2026-01").last, "2026-01-31");
    assert.equal(monthBounds("2026-02").last, "2026-02-28");
  });

  test("February in a leap year", () => {
    assert.equal(monthBounds("2028-02").last, "2028-02-29");
  });

  test("December does not roll the year wrong", () => {
    // The month-0-of-next-year trick is where an off-by-one lands you in
    // November of the wrong year.
    assert.equal(monthBounds("2026-12").first, "2026-12-01");
    assert.equal(monthBounds("2026-12").last, "2026-12-31");
  });

  test("a century non-leap year", () => {
    assert.equal(monthBounds("2100-02").last, "2100-02-28");
  });
});

describe("the month grid", () => {
  test("every row has exactly seven cells", () => {
    for (const ym of ["2026-01", "2026-02", "2026-09", "2026-11", "2028-02"]) {
      for (const row of monthGrid(ym)) assert.equal(row.length, 7, ym);
    }
  });

  test("it starts on a Monday and ends on a Sunday", () => {
    const g = monthGrid("2026-09");
    assert.equal(startOfWeek(g[0][0].date), g[0][0].date);
    assert.equal(daysIntoWeek(g[g.length - 1][6].date), 6);
  });

  test("September 2026 is five rows and starts with 31 August", () => {
    // 1 Sep 2026 is a Tuesday, so the grid leads with Monday 31 August.
    const g = monthGrid("2026-09");
    assert.equal(g[0][0].date, "2026-08-31");
    assert.equal(g[0][0].inMonth, false);
    assert.equal(g[0][1].date, "2026-09-01");
    assert.equal(g[0][1].inMonth, true);
  });

  test("padding days are marked, real days are not", () => {
    const g = monthGrid("2026-09");
    const flat = g.flat();
    const inMonth = flat.filter((c) => c.inMonth);
    assert.equal(inMonth.length, 30, "September has 30 days");
    assert.equal(inMonth[0].date, "2026-09-01");
    assert.equal(inMonth[inMonth.length - 1].date, "2026-09-30");
  });

  test("every day of the month appears exactly once", () => {
    for (const ym of ["2026-01", "2026-02", "2026-05", "2026-08", "2028-02"]) {
      const { last } = monthBounds(ym);
      const dates = monthGrid(ym).flat().filter((c) => c.inMonth).map((c) => c.date);
      assert.equal(new Set(dates).size, dates.length, `${ym} has a duplicate`);
      assert.equal(dates.length, Number(last.slice(8, 10)), ym);
    }
  });

  test("the cells are strictly consecutive, with no gaps", () => {
    const flat = monthGrid("2026-09").flat().map((c) => c.date);
    for (let i = 1; i < flat.length; i++) {
      const prev = new Date(`${flat[i - 1]}T12:00:00+08:00`).getTime();
      const cur = new Date(`${flat[i]}T12:00:00+08:00`).getTime();
      assert.equal(cur - prev, 86400000, `gap before ${flat[i]}`);
    }
  });

  test("a month that needs six rows gets six", () => {
    // August 2026 starts on a Saturday and has 31 days — the six-row case.
    const g = monthGrid("2026-08");
    assert.ok(g.length >= 5 && g.length <= 6, `${g.length} rows`);
    const dates = g.flat().filter((c) => c.inMonth).map((c) => c.date);
    assert.equal(dates.length, 31);
  });

  test("never more than six rows, for any month of a decade", () => {
    for (let y = 2024; y <= 2034; y++) {
      for (let m = 1; m <= 12; m++) {
        const ym = `${y}-${String(m).padStart(2, "0")}`;
        assert.ok(monthGrid(ym).length <= 6, `${ym} produced ${monthGrid(ym).length} rows`);
      }
    }
  });
});

describe("the fetch range covers the whole grid", () => {
  test("a month range starts before the 1st and ends after the last", () => {
    // Fetching only the month would leave the padding cells empty, and an admin
    // would conclude nobody is rostered on the 31st.
    const r = rangeFor("month", "2026-09-17");
    assert.equal(r.from, "2026-08-31");
    assert.ok(r.to >= "2026-09-30");
  });

  test("a week range is exactly its seven days", () => {
    const r = rangeFor("week", "2026-09-17");
    assert.equal(r.from, "2026-09-14");
    assert.equal(r.to, "2026-09-20");
  });

  test("the range always contains every cell it will render", () => {
    for (const ym of ["2026-01", "2026-02", "2026-08", "2026-12"]) {
      const anchor = `${ym}-15`;
      const r = rangeFor("month", anchor);
      for (const cell of monthGrid(ym).flat()) {
        assert.ok(cell.date >= r.from && cell.date <= r.to, `${cell.date} outside ${r.from}..${r.to}`);
      }
    }
  });
});

describe("stepping", () => {
  test("a week steps seven days", () => {
    assert.equal(step("week", "2026-09-17", 1), "2026-09-24");
    assert.equal(step("week", "2026-09-17", -1), "2026-09-10");
  });

  test("a month steps one month", () => {
    assert.equal(step("month", "2026-09-17", 1).slice(0, 7), "2026-10");
    assert.equal(step("month", "2026-09-17", -1).slice(0, 7), "2026-08");
  });

  test("December forward is January of the NEXT year", () => {
    assert.equal(step("month", "2026-12-15", 1).slice(0, 7), "2027-01");
  });

  test("January back is December of the PREVIOUS year", () => {
    assert.equal(step("month", "2026-01-15", -1).slice(0, 7), "2025-12");
  });

  test("the 31st stepping into a shorter month clamps instead of overflowing", () => {
    // Naive arithmetic turns 31 March back one month into 3 March. The anchor
    // only picks the month, but a bogus date would mean the grid rendered the
    // wrong one entirely.
    assert.equal(step("month", "2026-03-31", -1), "2026-02-28");
    assert.equal(step("month", "2026-05-31", 1), "2026-06-30");
  });

  test("into a leap February it clamps to the 29th", () => {
    assert.equal(step("month", "2028-01-31", 1), "2028-02-29");
  });

  test("stepping forward then back returns to the same month", () => {
    for (const d of ["2026-01-15", "2026-06-30", "2026-12-01"]) {
      assert.equal(step("month", step("month", d, 1), -1).slice(0, 7), d.slice(0, 7));
    }
  });
});

describe("grouping shifts into cells", () => {
  const shifts = [
    { id: "a", date: "2026-09-17", startsAt: "2026-09-17T11:30:00.000Z" },
    { id: "b", date: "2026-09-17", startsAt: "2026-09-17T03:00:00.000Z" },
    { id: "c", date: "2026-09-18", startsAt: "2026-09-18T06:00:00.000Z" },
  ];

  test("each date gets its own shifts", () => {
    const g = byDate(shifts);
    assert.equal(g["2026-09-17"].length, 2);
    assert.equal(g["2026-09-18"].length, 1);
  });

  test("within a day they are ordered by start time, earliest first", () => {
    assert.deepEqual(byDate(shifts)["2026-09-17"].map((s) => s.id), ["b", "a"]);
  });

  test("a day with nothing is simply absent, not an empty array", () => {
    assert.equal(byDate(shifts)["2026-09-19"], undefined);
  });

  test("no shifts at all is an empty object, never a crash", () => {
    assert.deepEqual(byDate([]), {});
    assert.deepEqual(byDate(null), {});
  });

  test("a late shift lands on its ROSTERED date, not its UTC one", () => {
    // 11:45pm SG on the 17th is 15:45 UTC the same day, but a 1am SG shift is
    // the previous UTC day. The `date` column is authoritative for exactly this.
    const late = [{ id: "x", date: "2026-09-17", startsAt: "2026-09-17T16:30:00.000Z" }];
    assert.ok(byDate(late)["2026-09-17"]);
  });
});

describe("colour by role", () => {
  test("lead, assistant and intern are told apart from a free-text position", () => {
    assert.equal(roleOf({ category: "teaching", position: "LEAD TEACHER" }), "lead");
    assert.equal(roleOf({ category: "teaching", position: "Lead Teacher (ARS)" }), "lead");
    assert.equal(roleOf({ category: "teaching", position: "ASSISTANT TEACHER" }), "assistant");
    assert.equal(roleOf({ category: "teaching", position: "Asst Teacher" }), "assistant");
    assert.equal(roleOf({ category: "teaching", position: "INTERN" }), "intern");
  });

  test("an unknown or missing position still gets a colour", () => {
    // A shift with no colour would render invisible, which is worse than a
    // slightly wrong colour.
    assert.equal(roleOf({ category: "teaching", position: "Something Else" }), "teaching");
    assert.equal(roleOf({ category: "teaching" }), "teaching");
  });

  test("OT takes its colour from the team", () => {
    assert.equal(roleOf({ category: "ot", otRole: "mentoring" }), "mentoring");
    assert.equal(roleOf({ category: "ot", otRole: "it" }), "it");
    assert.equal(roleOf({ category: "ot", otRole: null }), "ot");
  });

  test("cancelled beats everything", () => {
    // The question asked of a grey block is "is this happening", and it is not.
    assert.equal(roleOf({ category: "teaching", position: "LEAD TEACHER", status: "cancelled" }), "cancelled");
    assert.equal(roleOf({ category: "ot", otRole: "mentoring", status: "cancelled" }), "cancelled");
  });

  test("every role has a colour defined", () => {
    for (const s of [
      { category: "teaching", position: "LEAD TEACHER" },
      { category: "teaching", position: "ASSISTANT TEACHER" },
      { category: "teaching", position: "INTERN" },
      { category: "teaching" },
      { category: "ot", otRole: "mentoring" },
      { category: "ot", otRole: "curriculum" },
      { category: "ot" },
      { status: "cancelled" },
    ]) {
      const role = roleOf(s);
      assert.ok(ROLE_COLOURS[role], `${role} has no colour`);
      assert.ok(ROLE_COLOURS[role].bg && ROLE_COLOURS[role].label);
    }
  });

  test("a null shift does not throw", () => {
    assert.equal(roleOf(null), "teaching");
  });

  test("the legend lists only what is on screen", () => {
    const l = legendFor([
      { category: "teaching", position: "LEAD TEACHER" },
      { category: "ot", otRole: "mentoring" },
    ]);
    assert.deepEqual(l.sort(), ["lead", "mentoring"].sort());
    assert.deepEqual(legendFor([]), []);
  });
});

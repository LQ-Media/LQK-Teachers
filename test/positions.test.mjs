// The POSITION on a shift, and the REPEAT menu behind it.
//
// This is the module that decides whether a shift is paid teaching or logged
// OT, from one dropdown, so the tests that matter are the ones about what it
// REFUSES — an unrecognised position must not become a paid teaching shift by
// default, because that default would be a guess about money.
//
// Run under both timezones. The repeat arithmetic is all Singapore dates:
//   TZ=UTC npm test && TZ=Asia/Singapore npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SHIFT_POSITIONS,
  POSITION_GROUPS,
  POSITION_BY_KEY,
  REPEAT_OPTIONS,
  positionMeaning,
  positionFromProfile,
  repeatMeaning,
  needsUntil,
} from "../lib/hours/positions.js";

import { expandDates, buildShiftRows } from "../lib/hours/shifts.js";
import { OT_ROLE_BY_KEY } from "../lib/hours/rates.js";

describe("the position list", () => {
  test("every position is in one of the two groups the picker shows", () => {
    for (const p of SHIFT_POSITIONS) {
      assert.ok(POSITION_GROUPS.includes(p.group), `${p.key} has group ${p.group}`);
    }
  });

  test("keys are unique — two rows with one key would make the picker lie", () => {
    const keys = SHIFT_POSITIONS.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(Object.keys(POSITION_BY_KEY).length, keys.length);
  });

  test("every position is teaching or ot, and nothing else", () => {
    for (const p of SHIFT_POSITIONS) {
      assert.ok(p.category === "teaching" || p.category === "ot", `${p.key}: ${p.category}`);
    }
  });

  test("only OT positions carry an otRole", () => {
    for (const p of SHIFT_POSITIONS) {
      if (p.category === "teaching") assert.equal(p.otRole, null, p.key);
    }
  });

  test("every otRole used is one rates.js actually knows", () => {
    // Otherwise the payroll report would bucket the shift under a team that
    // does not exist, which reads as a missing team rather than a bad label.
    const known = new Set(Object.keys(OT_ROLE_BY_KEY));
    for (const p of SHIFT_POSITIONS) {
      if (p.otRole) assert.ok(known.has(p.otRole), `${p.key} → ${p.otRole}`);
    }
  });

  test("the teaching group is the five tiers, in tier order", () => {
    const teaching = SHIFT_POSITIONS.filter((p) => p.category === "teaching").map((p) => p.key);
    assert.deepEqual(teaching, [
      "Lead Teacher",
      "Lead Teacher (ARS)",
      "Assistant Teacher",
      "Probation",
      "Intern",
    ]);
  });
});

describe("what a position means", () => {
  test("a teaching position reads as teaching with no OT team", () => {
    const m = positionMeaning("Lead Teacher");
    assert.equal(m.category, "teaching");
    assert.equal(m.otRole, null);
  });

  test("a team position reads as OT and names the team", () => {
    assert.equal(positionMeaning("Events Team").category, "ot");
    assert.equal(positionMeaning("Events Team").otRole, "events");
    assert.equal(positionMeaning("IT Team").otRole, "it");
    assert.equal(positionMeaning("Mentoring Team").otRole, "mentoring");
  });

  test("Ad-hoc / OT is OT with no team", () => {
    const m = positionMeaning("Ad-hoc / OT");
    assert.equal(m.category, "ot");
    assert.equal(m.otRole, null);
  });

  test("surrounding whitespace is forgiven", () => {
    assert.equal(positionMeaning("  Intern  ")?.key, "Intern");
  });

  test("an unknown position is NULL, never a teaching default", () => {
    // The whole point. A caller that gets null must refuse; a caller that got
    // {category:'teaching'} would quietly pay for a shift nobody classified.
    assert.equal(positionMeaning("Head of Everything"), null);
    assert.equal(positionMeaning(""), null);
    assert.equal(positionMeaning(null), null);
    assert.equal(positionMeaning(undefined), null);
    assert.equal(positionMeaning("lead teacher"), null, "case matters — the key is the stored value");
  });
});

describe("guessing a position from an imported job title", () => {
  test("the spellings the Sheet actually contains all resolve", () => {
    assert.equal(positionFromProfile("LEAD TEACHER"), "Lead Teacher");
    assert.equal(positionFromProfile("Lead Teacher (ARS)"), "Lead Teacher (ARS)");
    assert.equal(positionFromProfile("LEAD TEACHER (ARS)"), "Lead Teacher (ARS)");
    assert.equal(positionFromProfile("Asst Teacher"), "Assistant Teacher");
    assert.equal(positionFromProfile("ASSISTANT TEACHER"), "Assistant Teacher");
    assert.equal(positionFromProfile("INTERN"), "Intern");
    assert.equal(positionFromProfile("Probation"), "Probation");
  });

  test("ARS beats plain LEAD, because both words are in the string", () => {
    assert.equal(positionFromProfile("lead teacher (ars)"), "Lead Teacher (ARS)");
  });

  test("an intern lead is read as an intern", () => {
    // Deliberate order: INTERN is checked first, because "Intern (lead track)"
    // is an intern and paying them as a lead teacher is the expensive mistake.
    assert.equal(positionFromProfile("Intern - Lead track"), "Intern");
  });

  test("the teams resolve too", () => {
    assert.equal(positionFromProfile("Curriculum"), "Curriculum Team");
    assert.equal(positionFromProfile("Events"), "Events Team");
    assert.equal(positionFromProfile("Logistics"), "Logistics");
    assert.equal(positionFromProfile("Mentor"), "Mentoring Team");
  });

  test("a title it cannot read is NULL, so the form asks", () => {
    assert.equal(positionFromProfile(""), null);
    assert.equal(positionFromProfile(null), null);
    assert.equal(positionFromProfile("Centre Manager"), null);
  });

  test("every guess it makes is a real position", () => {
    const titles = [
      "LEAD TEACHER", "Lead Teacher (ARS)", "Asst Teacher", "ASSISTANT TEACHER",
      "INTERN", "Probation", "Curriculum", "Events", "Logistics", "Mentor", "IT Support",
    ];
    for (const t of titles) {
      const guess = positionFromProfile(t);
      if (guess) assert.ok(positionMeaning(guess), `${t} → ${guess} is not a position`);
    }
  });
});

describe("the repeat menu", () => {
  test("it is exactly Sling's menu: never, this week, every 1–8 weeks", () => {
    assert.deepEqual(
      REPEAT_OPTIONS.map((r) => r.label),
      [
        "Never", "This week", "Every week",
        "Every 2 weeks", "Every 3 weeks", "Every 4 weeks",
        "Every 5 weeks", "Every 6 weeks", "Every 7 weeks", "Every 8 weeks",
      ]
    );
  });

  test("never means no recurrence at all", () => {
    assert.equal(repeatMeaning("never").weeks, 0);
    assert.equal(needsUntil("never"), false);
  });

  test("an unknown repeat falls back to never, which creates ONE shift", () => {
    // Safe direction: a typo'd repeat key makes one shift, not a year of them.
    assert.equal(repeatMeaning("every_99").weeks, 0);
    assert.equal(repeatMeaning("").weeks, 0);
    assert.equal(repeatMeaning(null).weeks, 0);
  });

  test("only 'this week' supplies its own end date", () => {
    assert.equal(needsUntil("this_week"), false);
    assert.equal(repeatMeaning("this_week").bounded, true);
    for (const r of REPEAT_OPTIONS) {
      if (r.key !== "this_week" && r.weeks > 0) {
        assert.equal(needsUntil(r.key), true, `${r.key} must ask for an end date`);
      }
    }
  });

  test("every N weeks reports N", () => {
    assert.equal(repeatMeaning("weekly").weeks, 1);
    assert.equal(repeatMeaning("every_2").weeks, 2);
    assert.equal(repeatMeaning("every_8").weeks, 8);
  });
});

describe("every N weeks, on the calendar", () => {
  const D = (from, to, days, n) => expandDates(from, to, days, new Set(), n);

  test("every week is every occurrence", () => {
    // 2026-09-14 is a Monday.
    assert.deepEqual(D("2026-09-14", "2026-10-12", [1], 1), [
      "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12",
    ]);
  });

  test("every 2 weeks skips the week in between", () => {
    assert.deepEqual(D("2026-09-14", "2026-10-12", [1], 2), ["2026-09-14", "2026-09-28", "2026-10-12"]);
  });

  test("two days in one fortnight stay together", () => {
    // The bug worth a test: counting seven-day blocks from the start DATE
    // rather than calendar weeks splits Mon and Wed across different
    // fortnights, so the grid shows a pattern nobody chose.
    assert.deepEqual(D("2026-09-14", "2026-10-01", [1, 3], 2), [
      "2026-09-14", "2026-09-16", "2026-09-28", "2026-09-30",
    ]);
  });

  test("starting mid-week still groups by calendar week", () => {
    // From Wednesday 16 Sep: that Wednesday, then the following fortnight's
    // Monday AND Wednesday together. The Monday of the start week (14 Sep) is
    // before fromDate, so it is not created.
    assert.deepEqual(D("2026-09-16", "2026-10-01", [1, 3], 2), [
      "2026-09-16", "2026-09-28", "2026-09-30",
    ]);
  });

  test("every 3 weeks, from a Tuesday", () => {
    assert.deepEqual(D("2026-09-15", "2026-11-30", [2], 3), [
      "2026-09-15", "2026-10-06", "2026-10-27", "2026-11-17",
    ]);
  });

  test("every 8 weeks is two months apart", () => {
    assert.deepEqual(D("2026-09-14", "2027-01-31", [1], 8), ["2026-09-14", "2026-11-09", "2027-01-04"]);
  });

  test("a bad interval behaves as every week rather than producing nothing", () => {
    assert.deepEqual(D("2026-09-14", "2026-09-28", [1], 0), ["2026-09-14", "2026-09-21", "2026-09-28"]);
    assert.deepEqual(D("2026-09-14", "2026-09-28", [1], 1.5), ["2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  test("the interval does not change the Sunday-as-0 convention", () => {
    // Sunday is 0, and the week starts Monday, so a Sunday is the LAST day of
    // its calendar week — the one place an off-by-one would hide.
    assert.deepEqual(D("2026-09-14", "2026-10-05", [0], 2), ["2026-09-20", "2026-10-04"]);
  });
});

describe("the interval reaches buildShiftRows", () => {
  const rowsFor = (everyWeeks) =>
    buildShiftRows({
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
      weekdays: [1],
      startTime: "16:00",
      endTime: "18:00",
      holidays: new Map(),
      skipHolidays: false,
      everyWeeks,
    }).rows;

  test("every week and every 2 weeks differ, and the times survive", () => {
    assert.equal(rowsFor(1).length, 5);
    assert.equal(rowsFor(2).length, 3);
    // The rows carry instants, not wall-clock strings — the caller already
    // holds the times. What matters is that every span is two hours the right
    // way round, under either timezone.
    for (const r of rowsFor(2)) {
      assert.ok(r.startsAt < r.endsAt, `${r.date}: ${r.startsAt} → ${r.endsAt}`);
      assert.equal((new Date(r.endsAt) - new Date(r.startsAt)) / 60000, 120, r.date);
    }
  });

  test("omitting everyWeeks still means every week", () => {
    // The default matters: every existing caller passes nothing.
    const rows = buildShiftRows({
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
      weekdays: [1],
      startTime: "16:00",
      endTime: "18:00",
      holidays: new Map(),
      skipHolidays: false,
    }).rows;
    assert.equal(rows.length, 5);
  });

  test("a public holiday is skipped and reported, interval or not", () => {
    const built = buildShiftRows({
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
      weekdays: [1],
      startTime: "16:00",
      endTime: "18:00",
      holidays: new Map([["2026-09-28", "Test Holiday"]]),
      skipHolidays: true,
      everyWeeks: 2,
    });
    assert.deepEqual(built.rows.map((r) => r.date), ["2026-09-14", "2026-10-12"]);
    assert.equal(built.skipped.length, 1);
    assert.equal(built.skipped[0].date, "2026-09-28");
  });
});

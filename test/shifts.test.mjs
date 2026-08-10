// Rostered shifts: matching, blocks, generation.
//
// Pay is the ROSTERED shift, so these rules decide what people are paid and
// who gets chased for a missed clock-in. Each test states the rule it protects.
//
// Run the whole suite under TZ=UTC as well as locally — production has no TZ
// set, so the container runs UTC while a dev laptop runs UTC+8. Several of
// these would pass in one and fail in the other if the SG helpers were wrong:
//   TZ=UTC npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  EARLY_GRACE_MIN,
  BLOCK_GAP_MIN,
  blocksOf,
  matchShift,
  shiftsRealisedBy,
  isOnShift,
  hasFinished,
  isMissed,
  shiftMinutes,
  expandDates,
  buildShiftRows,
  overlaps,
  findOverlaps,
} from "../lib/hours/shifts.js";

import {
  PH_MULTIPLIER,
  sessionPayCents,
  isoFromSgSpanning,
  addSgDays,
  sgWeekday,
  rateFor,
  formatMoney,
} from "../lib/hours/rates.js";

// A shift on 2026-08-10 (a Monday), given SG wall-clock times.
function shift(id, start, end, extra = {}) {
  const date = extra.date || "2026-08-10";
  return {
    id,
    date,
    startsAt: isoFromSgSpanning(date, start, end).startsAt,
    endsAt: isoFromSgSpanning(date, start, end).endsAt,
    status: "planned",
    ...extra,
  };
}
const at = (t, date = "2026-08-10") => `${date}T${t}:00+08:00`;

describe("blocks", () => {
  test("back-to-back shifts are one block", () => {
    const b = blocksOf([shift("a", "09:00", "11:00"), shift("b", "11:00", "13:00")]);
    assert.equal(b.length, 1);
    assert.deepEqual(b[0].map((s) => s.id), ["a", "b"]);
  });

  test("a short gap still counts as one block", () => {
    assert.equal(BLOCK_GAP_MIN, 30);
    const b = blocksOf([shift("a", "09:00", "11:00"), shift("b", "11:30", "13:00")]);
    assert.equal(b.length, 1);
  });

  test("a gap beyond the threshold splits the block", () => {
    const b = blocksOf([shift("a", "09:00", "11:00"), shift("b", "11:31", "13:00")]);
    assert.equal(b.length, 2);
  });

  test("input order doesn't matter", () => {
    const b = blocksOf([shift("b", "11:00", "13:00"), shift("a", "09:00", "11:00")]);
    assert.deepEqual(b[0].map((s) => s.id), ["a", "b"]);
  });

  test("cancelled shifts are never part of a block", () => {
    const b = blocksOf([
      shift("a", "09:00", "11:00"),
      shift("x", "11:00", "13:00", { status: "cancelled" }),
    ]);
    assert.equal(b.length, 1);
    assert.deepEqual(b[0].map((s) => s.id), ["a"]);
  });
});

describe("matching a clock-in to a shift", () => {
  const day = [shift("morning", "09:00", "11:00"), shift("evening", "16:00", "18:00")];

  test("a tap during a shift matches it", () => {
    assert.equal(matchShift(day, at("09:30")).id, "morning");
    assert.equal(matchShift(day, at("17:00")).id, "evening");
  });

  test("arriving early matches, up to the grace window", () => {
    assert.equal(EARLY_GRACE_MIN, 30);
    assert.equal(matchShift(day, at("08:30")).id, "morning");
    assert.equal(matchShift(day, at("08:29")), null, "beyond the grace window is unscheduled");
  });

  test("the right shift is picked when there are two in a day", () => {
    // 15:45 is inside evening's grace window but nowhere near morning.
    assert.equal(matchShift(day, at("15:45")).id, "evening");
  });

  test("a tap after a shift ended does not match it", () => {
    assert.equal(matchShift([shift("a", "09:00", "11:00")], at("11:01")), null);
  });

  test("the exact start and exact end both match", () => {
    const one = [shift("a", "09:00", "11:00")];
    assert.equal(matchShift(one, at("09:00")).id, "a");
    assert.equal(matchShift(one, at("11:00")).id, "a");
  });

  test("shifts on another day are never candidates", () => {
    assert.equal(matchShift(day, at("09:30", "2026-08-11")), null);
  });

  test("a cancelled shift is not matched — turning up is a real signal", () => {
    assert.equal(matchShift([shift("a", "09:00", "11:00", { status: "cancelled" })], at("09:30")), null);
  });

  test("no shifts at all is unscheduled, not an error", () => {
    assert.equal(matchShift([], at("09:30")), null);
    assert.equal(matchShift(null, at("09:30")), null);
  });
});

describe("what one tap realises", () => {
  test("a single tap covers the whole back-to-back block", () => {
    // The rule that stops an IT Head chasing a teacher for a class they taught.
    const day = [shift("a", "09:00", "11:00"), shift("b", "11:00", "13:00")];
    assert.deepEqual(shiftsRealisedBy(day, at("08:57")).map((s) => s.id), ["a", "b"]);
  });

  test("it does not reach across a real break", () => {
    const day = [shift("a", "09:00", "11:00"), shift("b", "16:00", "18:00")];
    assert.deepEqual(shiftsRealisedBy(day, at("09:05")).map((s) => s.id), ["a"]);
  });

  test("no match realises nothing", () => {
    assert.deepEqual(shiftsRealisedBy([shift("a", "09:00", "11:00")], at("14:00")), []);
  });
});

describe("on shift / finished", () => {
  const session = {
    startedAt: at("09:00"),
    endedAt: at("11:00"),
    clockInAt: at("09:02"),
    clockOutAt: null,
  };

  test("on shift between the scheduled start and end", () => {
    assert.equal(isOnShift(session, at("10:00")), true);
    assert.equal(isOnShift(session, at("08:59")), false);
    assert.equal(isOnShift(session, at("11:00")), false, "the end is exclusive");
  });

  test("never on shift without a clock-in, or after tapping out", () => {
    assert.equal(isOnShift({ ...session, clockInAt: null }, at("10:00")), false);
    assert.equal(isOnShift({ ...session, clockOutAt: at("10:30") }, at("10:45")), false);
    assert.equal(isOnShift(null, at("10:00")), false);
  });

  test("a shift is only finished once its end has actually passed", () => {
    // The rule that stops tomorrow's class being approved and paid today.
    const s = shift("a", "09:00", "11:00");
    assert.equal(hasFinished(s, at("10:59")), false);
    assert.equal(hasFinished(s, at("11:00")), true);
    assert.equal(hasFinished(s, at("11:01")), true);
    assert.equal(hasFinished({}, at("11:01")), false);
  });
});

describe("missed shifts", () => {
  const past = shift("a", "09:00", "11:00");

  test("a finished shift with no session is missed", () => {
    assert.equal(isMissed(past, at("12:00"), false), true);
  });

  test("not missed if it was worked, is still running, or was cancelled", () => {
    assert.equal(isMissed(past, at("12:00"), true), false);
    assert.equal(isMissed(past, at("10:00"), false), false);
    assert.equal(isMissed({ ...past, status: "cancelled" }, at("12:00"), false), false);
  });

  test("a resolved shift is never asked about again", () => {
    // Including a REJECTED one — otherwise the weekly report keeps chasing
    // something an admin already decided.
    assert.equal(isMissed({ ...past, resolution: "accepted" }, at("12:00"), false), false);
    assert.equal(isMissed({ ...past, resolution: "rejected" }, at("12:00"), false), false);
  });
});

describe("generating a roster", () => {
  test("picks only the requested weekdays", () => {
    // Aug 2026: the 3rd is a Monday.
    const d = expandDates("2026-08-03", "2026-08-16", [1, 3], new Set());
    assert.deepEqual(d, ["2026-08-03", "2026-08-05", "2026-08-10", "2026-08-12"]);
  });

  test("crosses a year boundary correctly", () => {
    const d = expandDates("2026-12-28", "2027-01-07", [1], new Set());
    assert.deepEqual(d, ["2026-12-28", "2027-01-04"]);
  });

  test("skips the dates it is told to", () => {
    const d = expandDates("2026-08-03", "2026-08-16", [1], new Set(["2026-08-10"]));
    assert.deepEqual(d, ["2026-08-03"]);
  });

  test("returns nothing for an inverted or empty range", () => {
    assert.deepEqual(expandDates("2026-08-16", "2026-08-03", [1], new Set()), []);
    assert.deepEqual(expandDates("2026-08-03", "2026-08-16", [], new Set()), []);
  });

  test("a mistyped far-future end date cannot generate unbounded rows", () => {
    const d = expandDates("2026-01-01", "2099-01-01", [0, 1, 2, 3, 4, 5, 6], new Set());
    assert.ok(d.length <= 800, `expected the guard to cap generation, got ${d.length}`);
  });

  test("holidays are skipped and reported, not silently dropped", () => {
    const holidays = new Map([["2026-08-10", "Test Holiday"]]);
    const { rows, skipped } = buildShiftRows({
      fromDate: "2026-08-03",
      toDate: "2026-08-16",
      weekdays: [1],
      startTime: "16:00",
      endTime: "18:00",
      holidays,
      skipHolidays: true,
    });
    assert.deepEqual(rows.map((r) => r.date), ["2026-08-03"]);
    assert.deepEqual(skipped, [{ date: "2026-08-10", reason: "Test Holiday" }]);
  });

  test("when holidays are kept, the shift carries the holiday name", () => {
    const holidays = new Map([["2026-08-10", "National Day"]]);
    const { rows, skipped } = buildShiftRows({
      fromDate: "2026-08-10",
      toDate: "2026-08-10",
      weekdays: [1],
      startTime: "16:00",
      endTime: "18:00",
      holidays,
      skipHolidays: false,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].phName, "National Day");
    assert.deepEqual(skipped, []);
  });
});

describe("shifts that cross midnight", () => {
  test("the end rolls to the next day rather than being rejected", () => {
    const span = isoFromSgSpanning("2026-08-10", "22:00", "01:00");
    assert.equal(span.startsAt, "2026-08-10T14:00:00.000Z"); // 22:00 SG
    assert.equal(span.endsAt, "2026-08-10T17:00:00.000Z"); // 01:00 SG next day
    assert.ok(new Date(span.endsAt) > new Date(span.startsAt));
  });

  test("a normal shift is untouched", () => {
    const span = isoFromSgSpanning("2026-08-10", "09:00", "11:00");
    assert.equal(span.startsAt, "2026-08-10T01:00:00.000Z");
    assert.equal(span.endsAt, "2026-08-10T03:00:00.000Z");
  });

  test("its duration is the real three hours", () => {
    const span = isoFromSgSpanning("2026-08-10", "22:00", "01:00");
    assert.equal(shiftMinutes({ startsAt: span.startsAt, endsAt: span.endsAt }), 180);
  });

  test("junk times give null, not an Invalid Date", () => {
    assert.equal(isoFromSgSpanning("2026-08-10", "not-a-time", "11:00"), null);
  });
});

describe("SG date helpers under any host timezone", () => {
  test("weekday is Singapore's, not the host's", () => {
    assert.equal(sgWeekday("2026-08-10"), 1, "2026-08-10 is a Monday in SG");
    assert.equal(sgWeekday("2026-08-09"), 0);
    assert.equal(sgWeekday("2026-08-15"), 6);
  });

  test("day arithmetic crosses months and years", () => {
    assert.equal(addSgDays("2026-08-31", 1), "2026-09-01");
    assert.equal(addSgDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addSgDays("2027-01-01", -1), "2026-12-31");
    assert.equal(addSgDays("2026-02-28", 1), "2026-03-01");
  });
});

describe("overlaps", () => {
  test("detects a genuine clash", () => {
    assert.equal(overlaps(shift("a", "09:00", "11:00"), shift("b", "10:00", "12:00")), true);
  });

  test("touching shifts do not overlap", () => {
    assert.equal(overlaps(shift("a", "09:00", "11:00"), shift("b", "11:00", "13:00")), false);
  });

  test("finds clashing pairs so an admin is told at rostering time", () => {
    const clashes = findOverlaps([
      shift("a", "09:00", "11:00"),
      shift("b", "10:00", "12:00"),
      shift("c", "16:00", "18:00"),
    ]);
    assert.equal(clashes.length, 1);
    assert.deepEqual(clashes[0].map((s) => s.id), ["a", "b"]);
  });

  test("a clean roster has no clashes", () => {
    assert.deepEqual(findOverlaps([shift("a", "09:00", "11:00"), shift("b", "11:00", "13:00")]), []);
  });
});

describe("public holiday pay", () => {
  test("a PH shift pays the multiplier on the hourly rate", () => {
    assert.equal(PH_MULTIPLIER, 2);
    const rate = rateFor("teaching", "lead"); // $20/hr
    assert.equal(formatMoney(sessionPayCents(150, rate, null)), "$50.00");
    assert.equal(formatMoney(sessionPayCents(150, rate, PH_MULTIPLIER)), "$100.00");
  });

  test("OT on a public holiday gets the multiplier too", () => {
    assert.equal(formatMoney(sessionPayCents(60, rateFor("ot", "lead"), 2)), "$20.00");
  });

  test("a missing or nonsense multiplier means normal pay, never zero", () => {
    const rate = rateFor("teaching", "asst"); // $15/hr
    assert.equal(sessionPayCents(60, rate, null), 1500);
    assert.equal(sessionPayCents(60, rate, undefined), 1500);
    assert.equal(sessionPayCents(60, rate, 0), 1500);
    assert.equal(sessionPayCents(60, rate, "abc"), 1500);
  });

  test("no rate still means no pay, not NaN", () => {
    assert.equal(sessionPayCents(120, null, 2), 0);
  });

  test("the snapshot is what pays — changing the constant cannot rewrite it", () => {
    // A session approved at 2x keeps 2x even if PH_MULTIPLIER later becomes 1.5.
    const approvedAt = 2;
    const rate = rateFor("teaching", "lead");
    const paid = sessionPayCents(120, rate, approvedAt);
    assert.equal(formatMoney(paid), "$80.00");
    assert.notEqual(paid, sessionPayCents(120, rate, 1.5));
  });
});

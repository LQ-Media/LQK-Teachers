// The clock-in-based pay model, the attendance flags, and the monthly payroll
// report that replaces the Sling export and the tally by hand.
//
// Several cases below are REAL ROWS from the August 2026 Sling export, kept
// because the point of this work is that the portal's numbers can be checked
// against a month that was already done the old way. Where the portal is meant
// to DIVERGE from Sling — early clock-ins — the test says so in its name, so a
// future reader does not "fix" it back.
//
// Pure module, so it runs under UTC and SGT alike. Every fixture is written in
// SG local time and converted, because the container runs UTC and a laptop does
// not, and a payroll test that passes only in one of them is worthless.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  OT_RATE,
  PH_MULTIPLIER,
  isTrackedOnly,
  isoFromSgSpanning,
  otRate,
  payrollHours,
  rateFor,
} from "../lib/hours/rates.js";
import {
  LATE_FLAG_MIN,
  attendanceOf,
  expectsClockIn,
  payableWindow,
  roundClockIn,
} from "../lib/hours/attendance.js";
import { formatDuration, monthlyReport, reportCsv, exceptions } from "../lib/hours/report.js";

/** A teaching shift on an SG date, e.g. shift("2026-08-02", "07:30", "15:00"). */
function shift(date, start, end, extra = {}) {
  const { startsAt, endsAt } = isoFromSgSpanning(date, start, end);
  return {
    id: `${date}-${start}`,
    teacherId: "t1",
    teacherName: "AINUL BINA ABDUL LATHEEF",
    category: "teaching",
    payTier: "asst",
    status: "planned",
    startsAt,
    endsAt,
    clockInAt: null,
    note: "",
    ...extra,
  };
}

/** An SG wall-clock instant, for clock-in fixtures. */
function at(date, time) {
  return isoFromSgSpanning(date, time, time).startsAt;
}

// ---- rounding ----------------------------------------------------------

describe("payroll hour rounding", () => {
  test("Karim's own examples: under 30 down, over 30 up", () => {
    assert.equal(payrollHours(5 * 60 + 20), 5);
    assert.equal(payrollHours(5 * 60 + 45), 6);
  });

  test("exactly thirty rounds up, and zero stays zero", () => {
    assert.equal(payrollHours(30), 1);
    assert.equal(payrollHours(29), 0);
    assert.equal(payrollHours(0), 0);
  });

  test("rounds the total, so a month of short shifts cannot drift", () => {
    // Twenty 2h55m shifts. Rounding each one down first loses nearly an hour.
    const minutes = 20 * 175;
    assert.equal(payrollHours(minutes), 58);
    assert.notEqual(
      payrollHours(minutes),
      Array.from({ length: 20 }, () => payrollHours(175)).reduce((a, b) => a + b, 0)
    );
  });
});

// ---- rates -------------------------------------------------------------

describe("rates", () => {
  test("public holidays pay 1.5x", () => {
    assert.equal(PH_MULTIPLIER, 1.5);
  });

  test("the three paid teams sit at the flat OT rate", () => {
    for (const role of ["curriculum", "events", "logistics"]) {
      assert.equal(otRate(role), OT_RATE);
      assert.equal(isTrackedOnly(role), false);
    }
  });

  test("mentoring and IT are tracked but never paid", () => {
    for (const role of ["mentoring", "it"]) {
      assert.equal(isTrackedOnly(role), true);
      assert.equal(otRate(role), 0);
    }
  });

  test("an unknown or absent role is plain OT, not free labour", () => {
    assert.equal(otRate(null), OT_RATE);
    assert.equal(otRate("nonsense"), OT_RATE);
    assert.equal(rateFor("ot", "lead"), OT_RATE);
  });

  test("a missing teaching tier still blocks, and is not confused with unpaid", () => {
    assert.equal(rateFor("teaching", null), null);
    assert.equal(rateFor("ot", null, "mentoring"), 0);
  });
});

// ---- the pay window ----------------------------------------------------

describe("pay window", () => {
  test("Sling row, Ainul 2 Aug: clocked in 7:35 for a 7:30 shift, pays 7h25", () => {
    const s = shift("2026-08-02", "07:30", "15:00", { clockInAt: at("2026-08-02", "07:35") });
    assert.equal(payableWindow(s, s.clockInAt).minutes, 7 * 60 + 25);
  });

  test("Sling row, Ainul 16 Aug: clocked in 7:40, pays 7h20", () => {
    const s = shift("2026-08-16", "07:30", "15:00", { clockInAt: at("2026-08-16", "07:40") });
    assert.equal(payableWindow(s, s.clockInAt).minutes, 7 * 60 + 20);
  });

  test("DIVERGES FROM SLING: 30 minutes early pays the roster, not 3h30", () => {
    // Izyan, 22 Aug: scheduled 12:00-15:00, clocked in 11:30. Sling paid 3h30.
    const s = shift("2026-08-22", "12:00", "15:00", { clockInAt: at("2026-08-22", "11:30") });
    assert.equal(payableWindow(s, s.clockInAt).minutes, 3 * 60);
  });

  test("on the dot pays the whole rostered shift", () => {
    const s = shift("2026-08-14", "15:00", "20:00", { clockInAt: at("2026-08-14", "15:00") });
    assert.equal(payableWindow(s, s.clockInAt).minutes, 5 * 60);
  });

  test("no clock-in pays nothing at all, pending an adjustment", () => {
    const s = shift("2026-08-01", "12:00", "15:00");
    assert.equal(payableWindow(s, null), null);
  });

  test("a tap after the shift ended is unresolved, not a zero-minute shift", () => {
    const s = shift("2026-08-01", "12:00", "15:00", { clockInAt: at("2026-08-01", "15:30") });
    assert.equal(payableWindow(s, s.clockInAt), null);
  });

  test("OT needs no tap and pays its whole rostered window", () => {
    const s = shift("2026-08-16", "17:30", "19:00", { category: "ot", payTier: null });
    assert.equal(expectsClockIn(s), false);
    assert.equal(payableWindow(s, null).minutes, 90);
  });

  test("a cancelled shift pays nothing even with a clock-in on it", () => {
    const s = shift("2026-08-01", "12:00", "15:00", {
      status: "cancelled",
      clockInAt: at("2026-08-01", "12:00"),
    });
    assert.equal(payableWindow(s, s.clockInAt), null);
  });

  test("pay never runs past the scheduled end — there is no clock-out", () => {
    const s = shift("2026-08-01", "12:00", "15:00", { clockInAt: at("2026-08-01", "12:00") });
    const w = payableWindow(s, s.clockInAt);
    assert.equal(w.endsAt, s.endsAt);
  });

  test("an overnight shift still measures correctly", () => {
    const s = shift("2026-08-01", "22:00", "01:00", { clockInAt: at("2026-08-01", "22:10") });
    assert.equal(payableWindow(s, s.clockInAt).minutes, 2 * 60 + 50);
  });
});

// ---- attendance flags --------------------------------------------------

describe("attendance", () => {
  test("a missing clock-in is always flagged", () => {
    const a = attendanceOf(shift("2026-08-01", "12:00", "15:00"), null);
    assert.equal(a.state, "missing");
    assert.equal(a.flagged, true);
  });

  test("late is recorded whatever the size, flagged past the threshold", () => {
    const s = shift("2026-08-01", "12:00", "15:00");
    const small = attendanceOf(s, at("2026-08-01", "12:05"));
    assert.equal(small.state, "late");
    assert.equal(small.lateMinutes, 5);
    assert.equal(small.flagged, false);

    const big = attendanceOf(s, at("2026-08-01", "12:35"));
    assert.equal(big.lateMinutes, 35);
    assert.equal(big.flagged, true);
  });

  test("the threshold itself flags", () => {
    const s = shift("2026-08-01", "12:00", "15:00");
    const a = attendanceOf(s, at("2026-08-01", "12:10"));
    assert.equal(a.lateMinutes, LATE_FLAG_MIN);
    assert.equal(a.flagged, true);
  });

  test("early is recorded and never flagged", () => {
    const a = attendanceOf(shift("2026-08-22", "12:00", "15:00"), at("2026-08-22", "11:30"));
    assert.equal(a.state, "early");
    assert.equal(a.earlyMinutes, 30);
    assert.equal(a.flagged, false);
  });

  test("OT is never flagged for want of a tap it never needed", () => {
    const s = shift("2026-08-16", "17:30", "19:00", { category: "ot" });
    const a = attendanceOf(s, null);
    assert.equal(a.state, "n/a");
    assert.equal(a.flagged, false);
  });

  test("a cancelled shift is not chased", () => {
    const s = shift("2026-08-01", "12:00", "15:00", { status: "cancelled" });
    assert.equal(attendanceOf(s, null).flagged, false);
  });
});

// ---- clock rounding ----------------------------------------------------

describe("clock-in rounding", () => {
  test("rounds to the nearest five minutes, both ways", () => {
    assert.equal(roundClockIn(at("2026-08-01", "07:33")), at("2026-08-01", "07:35"));
    assert.equal(roundClockIn(at("2026-08-01", "07:32")), at("2026-08-01", "07:30"));
    assert.equal(roundClockIn(at("2026-08-01", "07:35")), at("2026-08-01", "07:35"));
  });

  test("nothing in, nothing out", () => {
    assert.equal(roundClockIn(null), null);
    assert.equal(roundClockIn("not a date"), null);
  });
});

// ---- the monthly report ------------------------------------------------

describe("monthly report", () => {
  const shifts = [
    shift("2026-08-02", "07:30", "15:00", { clockInAt: at("2026-08-02", "07:35") }),
    shift("2026-08-16", "07:30", "15:00", { clockInAt: at("2026-08-16", "07:40") }),
    shift("2026-08-16", "17:30", "19:00", { category: "ot", payTier: null }),
    shift("2026-08-20", "09:00", "11:00", { category: "ot", otRole: "mentoring", payTier: null }),
    shift("2026-08-22", "12:00", "15:00"), // never clocked in
    shift("2026-09-01", "07:30", "15:00", { clockInAt: at("2026-09-01", "07:30") }),
  ];

  test("only the requested month is counted", () => {
    const [block] = monthlyReport(shifts, "2026-08");
    assert.equal(block.rows.length, 5);
  });

  test("teaching total is payable time, rounded once", () => {
    const [block] = monthlyReport(shifts, "2026-08");
    // 7h25 + 7h20 + 0 (never clocked in) = 14h45 -> 15
    assert.equal(block.teachingMinutes, 14 * 60 + 45);
    assert.equal(block.teachingHours, 15);
  });

  test("OT is rostered time and excludes the tracked-only teams", () => {
    const [block] = monthlyReport(shifts, "2026-08");
    assert.equal(block.otMinutes, 90);
    assert.equal(block.otHours, 2);
    assert.equal(block.trackedMinutes, 120);
    assert.equal(block.trackedHours, 2);
  });

  test("unpaid mentoring hours never leak into the OT total", () => {
    const [block] = monthlyReport(shifts, "2026-08");
    assert.ok(block.otMinutes < block.otMinutes + block.trackedMinutes);
    assert.equal(block.otMinutes, 90);
  });

  test("difference is negative when short of the roster, and only then", () => {
    const [block] = monthlyReport(shifts, "2026-08");
    const aug2 = block.rows.find((r) => r.date === "2026-08-02");
    assert.equal(aug2.differenceMinutes, -5);
    assert.ok(block.rows.every((r) => r.differenceMinutes <= 0));
  });

  test("both the missing tap and the ten-minutes-late one reach the exception list", () => {
    const blocks = monthlyReport(shifts, "2026-08");
    const flagged = exceptions(blocks);
    // Aug 16 was 7:40 for a 7:30 shift — exactly LATE_FLAG_MIN, so it counts.
    // Aug 22 was never tapped at all.
    assert.deepEqual(
      flagged.map((f) => [f.date, f.attendance]),
      [
        ["2026-08-16", "late"],
        ["2026-08-22", "missing"],
      ]
    );
  });

  test("the five-minutes-late shift is paid short but not chased", () => {
    const [block] = monthlyReport(shifts, "2026-08");
    const aug2 = block.rows.find((r) => r.date === "2026-08-02");
    assert.equal(aug2.attendance, "late");
    assert.equal(aug2.lateMinutes, 5);
    assert.equal(aug2.flagged, false);
  });

  test("the IT Head's note rides along to the export", () => {
    const withNote = shifts.map((s) =>
      s.date === "2026-08-22" ? s : { ...s, note: s.startsAt.includes("2026-08-22") ? "Overslept, MH informed" : "" }
    );
    const [block] = monthlyReport(withNote, "2026-08");
    const row = block.rows.find((r) => r.date === "2026-08-22");
    assert.equal(row.note, "Overslept, MH informed");
  });

  test("cancelled shifts do not pad the block", () => {
    const withCancel = [...shifts, shift("2026-08-05", "12:00", "15:00", { status: "cancelled" })];
    const [block] = monthlyReport(withCancel, "2026-08");
    assert.equal(block.rows.length, 5);
  });

  test("teachers are grouped and sorted by name", () => {
    const two = [
      ...shifts,
      shift("2026-08-03", "12:00", "15:00", {
        teacherId: "t2",
        teacherName: "AISYAH BINTE AHMAD DAHLAN",
        clockInAt: at("2026-08-03", "12:00"),
      }),
    ];
    const blocks = monthlyReport(two, "2026-08");
    assert.equal(blocks.length, 2);
    // AINul before AISyah — N before S, as the payroll sheet orders them.
    assert.deepEqual(blocks.map((b) => b.employee), [
      "AINUL BINA ABDUL LATHEEF",
      "AISYAH BINTE AHMAD DAHLAN",
    ]);
  });
});

describe("CSV export", () => {
  test("Sling's duration spelling, including the negative difference", () => {
    assert.equal(formatDuration(7 * 60 + 25), "7h 25min");
    assert.equal(formatDuration(45), "45min");
    assert.equal(formatDuration(180), "3h");
    assert.equal(formatDuration(-5), "-5min");
    assert.equal(formatDuration(0), "-");
  });

  test("a subtotal row per teacher carries the two totals", () => {
    const blocks = monthlyReport(
      [shift("2026-08-02", "07:30", "15:00", { clockInAt: at("2026-08-02", "07:35") })],
      "2026-08"
    );
    const csv = reportCsv(blocks);
    const [header, subtotal, row] = csv.split("\n");
    assert.match(header, /TOTAL OT HOURS \(hr\),TOTAL TEACHING HOURS \(hr\)/);
    assert.match(subtotal, /^AINUL BINA ABDUL LATHEEF,,,,,,7h 25min,,,0,7,/);
    assert.match(row, /2026-08-02/);
  });

  test("a note containing a comma survives the round trip", () => {
    const blocks = monthlyReport(
      [shift("2026-08-02", "07:30", "15:00", { clockInAt: at("2026-08-02", "07:35"), note: "Late, bus broke down" })],
      "2026-08"
    );
    assert.match(reportCsv(blocks), /"Late, bus broke down"/);
  });
});

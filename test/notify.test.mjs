// When a shift notification is due, and what it says.
//
// The interesting cases here are all EDGES, because that is what a scheduler
// is: a thing that runs at arbitrary moments and must decide the same way every
// time. Each test below is a moment a real tick could land on.
//
// Runs under both TZ=UTC and TZ=Asia/Singapore in CI. The window logic is in
// absolute time and must not care; the message text is Singapore-local and must
// be identical under either.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  REMIND_BEFORE_MIN,
  NO_CLOCK_IN_AFTER_MIN,
  reminderDue,
  noClockInDue,
  dueFor,
  teacherMessage,
  managerMessage,
} from "../lib/hours/notify.js";
import { LATE_FLAG_MIN } from "../lib/hours/attendance.js";

// A 7:30pm–9:30pm SG teaching shift on 17 Sep 2026. SG is UTC+8 year round.
const START = "2026-09-17T11:30:00.000Z"; // 19:30 SG
const END = "2026-09-17T13:30:00.000Z"; // 21:30 SG

const shift = {
  id: "s1",
  teacherId: "t1",
  teacherName: "Nur Aisyah",
  category: "teaching",
  status: "planned",
  branch: "Woods Square",
  startsAt: START,
  endsAt: END,
};

/** `mins` minutes from the shift's start (negative = before). */
function at(mins) {
  return new Date(new Date(START).getTime() + mins * 60000).toISOString();
}

describe("the reminder window", () => {
  test("opens exactly 30 minutes before the start", () => {
    assert.equal(reminderDue(shift, at(-REMIND_BEFORE_MIN)), true);
    assert.equal(reminderDue(shift, at(-REMIND_BEFORE_MIN - 1)), false);
  });

  test("stays open all the way to the start", () => {
    assert.equal(reminderDue(shift, at(-20)), true);
    assert.equal(reminderDue(shift, at(-5)), true);
    assert.equal(reminderDue(shift, at(-1)), true);
  });

  test("closes AT the start — a reminder to be somewhere you already should be is noise", () => {
    assert.equal(reminderDue(shift, at(0)), false);
    assert.equal(reminderDue(shift, at(1)), false);
  });

  test("a server that misses the 30-minute mark still reminds when it comes back", () => {
    // The whole reason this is a window and not an instant: deploys restart the
    // process, and Railway can take a minute. A reminder at T-4 is still worth
    // sending; one at T+4 is not.
    assert.equal(reminderDue(shift, at(-4)), true);
  });

  test("never for OT — an admin enters it after the fact, nobody is expected", () => {
    assert.equal(reminderDue({ ...shift, category: "ot" }, at(-10)), false);
  });

  test("never for a cancelled shift", () => {
    assert.equal(reminderDue({ ...shift, status: "cancelled" }, at(-10)), false);
  });
});

describe("the missing clock-in window", () => {
  test("uses the same 15 minutes as the report's late flag", () => {
    // Two numbers for "late" would be two definitions of late.
    assert.equal(NO_CLOCK_IN_AFTER_MIN, LATE_FLAG_MIN);
  });

  test("silent until 15 minutes past the start", () => {
    assert.equal(noClockInDue(shift, null, at(0)), false);
    assert.equal(noClockInDue(shift, null, at(14)), false);
    assert.equal(noClockInDue(shift, null, at(15)), true);
  });

  test("stops the moment they clock in", () => {
    assert.equal(noClockInDue(shift, at(16), at(20)), false);
  });

  test("an early clock-in still counts as clocked in", () => {
    // Early taps earn nothing, but they are not an absence.
    assert.equal(noClockInDue(shift, at(-10), at(30)), false);
  });

  test("closes at the scheduled end — after that it is the IT Head's list, not a push", () => {
    assert.equal(noClockInDue(shift, null, at(119)), true);
    assert.equal(noClockInDue(shift, null, at(120)), false);
    assert.equal(noClockInDue(shift, null, at(600)), false);
  });

  test("a cancelled shift never produces one", () => {
    // Telling a teacher off for not attending a class that was called off is
    // worse than saying nothing at all.
    assert.equal(noClockInDue({ ...shift, status: "cancelled" }, null, at(30)), false);
  });

  test("never for OT", () => {
    assert.equal(noClockInDue({ ...shift, category: "ot" }, null, at(30)), false);
  });
});

describe("what is due at a given moment", () => {
  test("the two windows never overlap", () => {
    // A reminder and a no-show cannot both be due, because one closes where
    // the other has not yet opened.
    for (let m = -40; m <= 130; m++) {
      const kinds = dueFor(shift, null, at(m)).map((d) => d.kind);
      assert.ok(
        !(kinds.includes("reminder") && kinds.includes("no_clock_in")),
        `both due at T${m >= 0 ? "+" : ""}${m}`
      );
    }
  });

  test("quotes the REAL minutes, not the threshold", () => {
    // A reminder that goes out late must not claim to be 30 minutes early.
    assert.deepEqual(dueFor(shift, null, at(-7)), [{ kind: "reminder", minutes: 7 }]);
    assert.deepEqual(dueFor(shift, null, at(42)), [{ kind: "no_clock_in", minutes: 42 }]);
  });

  test("nothing is due for a shift nowhere near now", () => {
    assert.deepEqual(dueFor(shift, null, at(-600)), []);
    assert.deepEqual(dueFor(shift, null, at(1440)), []);
  });
});

describe("the messages", () => {
  test("the teacher's reminder names the Singapore time and the centre", () => {
    const m = teacherMessage("reminder", shift, 30);
    assert.match(m.title, /7:30 pm/i);
    assert.match(m.body, /Woods Square/);
    assert.match(m.body, /Clock in/);
    assert.equal(m.url, "/hours");
  });

  test("'in a minute' rather than 'in 1 minutes'", () => {
    assert.match(teacherMessage("reminder", shift, 1).title, /in a minute/);
    assert.match(teacherMessage("reminder", shift, 2).title, /in 2 minutes/);
  });

  test("the teacher's no-show message offers both ways out", () => {
    const m = teacherMessage("no_clock_in", shift, 15);
    assert.match(m.body, /15 minutes ago/);
    assert.match(m.body, /clock in/i);
    assert.match(m.body, /IT Head/);
  });

  test("the IT Head's version leads with the NAME", () => {
    // They read this on a phone while covering two centres. The first word has
    // to be who to chase.
    const m = managerMessage("no_clock_in", shift, 20);
    assert.ok(m.title.startsWith("Nur Aisyah"), m.title);
    assert.match(m.body, /Woods Square/);
    assert.equal(m.url, "/admin?tab=shifts");
  });

  test("an IT Head is never sent a reminder — that is the teacher's business", () => {
    assert.equal(managerMessage("reminder", shift, 30), null);
  });

  test("a nameless teacher still produces a sendable message", () => {
    const m = managerMessage("no_clock_in", { ...shift, teacherName: null }, 20);
    assert.match(m.title, /^A teacher/);
  });

  test("a branchless shift reads cleanly, with no dangling 'at'", () => {
    const m = teacherMessage("reminder", { ...shift, branch: null }, 30);
    assert.ok(!/\bat\s*\./.test(m.body), m.body);
    assert.ok(!m.body.includes("undefined") && !m.body.includes("null"), m.body);
  });

  test("every message carries a tag unique to its shift and kind", () => {
    // The tag is what stops a phone stacking three copies of the same nag.
    const a = teacherMessage("reminder", shift, 30).tag;
    const b = teacherMessage("no_clock_in", shift, 20).tag;
    const c = managerMessage("no_clock_in", shift, 20).tag;
    assert.equal(new Set([a, b, c]).size, 3);
    for (const t of [a, b, c]) assert.match(t, /s1/);
  });

  test("the offer message says what it is and where", () => {
    const m = teacherMessage("offered", shift, 0);
    assert.match(m.body, /needs cover/);
    assert.match(m.body, /Woods Square/);
  });

  test("no message ever leaks a raw ISO timestamp", () => {
    for (const m of [
      teacherMessage("reminder", shift, 30),
      teacherMessage("no_clock_in", shift, 20),
      teacherMessage("offered", shift, 0),
      managerMessage("no_clock_in", shift, 20),
    ]) {
      assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(`${m.title} ${m.body}`), `${m.title} / ${m.body}`);
    }
  });
});

describe("a shift that crosses Singapore midnight", () => {
  // 11:45pm–1:00am. The windows are absolute instants, so the date rolling over
  // must not matter — but the message must still read as a Singapore time.
  const late = {
    ...shift,
    id: "s2",
    startsAt: "2026-09-17T15:45:00.000Z", // 23:45 SG
    endsAt: "2026-09-17T17:00:00.000Z", // 01:00 SG next day
  };

  test("the reminder fires on the previous SG day", () => {
    assert.equal(reminderDue(late, "2026-09-17T15:20:00.000Z"), true);
  });

  test("the no-show fires after SG midnight", () => {
    assert.equal(noClockInDue(late, null, "2026-09-17T16:05:00.000Z"), true);
    assert.equal(noClockInDue(late, null, "2026-09-17T17:05:00.000Z"), false);
  });

  test("the time reads 11:45 pm, not 3:45 pm", () => {
    assert.match(teacherMessage("reminder", late, 25).title, /11:45 pm/i);
  });
});

// How an event's stored date is read back (lib/events/when.js).
//
// The bug these exist for: starts_at is Singapore WALL TIME with no zone on the
// end ("2026-08-30T18:00"), and `new Date()` reads a naive string in the
// SERVER's zone. Railway's container is UTC, so a 6:00 pm majlis was shown to
// guests as 2:00 am the next day — while looking perfectly correct on a
// Singapore laptop, where the two errors cancel.
//
// So these run under TZ=UTC deliberately (see the process.env line below): a
// test that only passes in Singapore is exactly the test that missed this.

process.env.TZ = "UTC";

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { eventInstant, endOfDeadlineDay } from "../lib/events/when.js";
import { formatEventDate } from "../lib/events/i18n.js";
import { buildInviteIcs } from "../lib/events/ics.js";

const sgt = (d) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
  }).format(d);

describe("eventInstant", () => {
  test("a naive stored value is Singapore wall time, whatever the server's zone", () => {
    assert.equal(sgt(eventInstant("2026-08-30T18:00")), "30/08/2026, 18:00");
    assert.equal(eventInstant("2026-08-30T18:00").toISOString(), "2026-08-30T10:00:00.000Z");
  });

  test("seconds, and a space instead of the T, are the same value", () => {
    assert.equal(eventInstant("2026-08-30T18:00:00").toISOString(), "2026-08-30T10:00:00.000Z");
    assert.equal(eventInstant("2026-08-30 18:00").toISOString(), "2026-08-30T10:00:00.000Z");
  });

  test("a value that already names its zone is left exactly where it is", () => {
    // Older rows written as UTC must not be shunted another 8 hours.
    assert.equal(eventInstant("2026-08-30T10:00:00.000Z").toISOString(), "2026-08-30T10:00:00.000Z");
    assert.equal(eventInstant("2026-08-30T18:00:00+08:00").toISOString(), "2026-08-30T10:00:00.000Z");
  });

  test("nothing usable reads as nothing, never as 1970", () => {
    for (const junk of [null, undefined, "", "   ", "not a date"]) {
      assert.equal(eventInstant(junk), null);
    }
  });
});

test("endOfDeadlineDay closes at the end of the day in Singapore, not UTC", () => {
  assert.equal(endOfDeadlineDay("2026-09-01").toISOString(), "2026-09-01T15:59:59.000Z");
  assert.equal(endOfDeadlineDay(null), null);
});

describe("what the guest is actually shown", () => {
  test("the invitation prints the hour that was typed into the editor", () => {
    assert.match(formatEventDate("2026-08-30T18:00", "en"), /30 August 2026/);
    assert.match(formatEventDate("2026-08-30T18:00", "en"), /6:00\s?pm/i);
  });

  test("a late-evening majlis does not roll onto the next day", () => {
    // 11pm + UTC parsing used to print "31 August ... 7:00 am".
    assert.match(formatEventDate("2026-08-30T23:00", "en"), /30 August 2026/);
  });

  test("the calendar file carries the same wall time as the invitation", () => {
    const ics = buildInviteIcs({ event: { title: "Maulid", starts_at: "2026-08-30T18:00" }, uid: "u1" });
    assert.match(ics, /DTSTART;TZID=Asia\/Singapore:20260830T180000/);
    // Default length is three hours.
    assert.match(ics, /DTEND;TZID=Asia\/Singapore:20260830T210000/);
  });
});

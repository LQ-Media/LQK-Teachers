// Money and Singapore-time helpers — the payroll path.
//
// These hours have replaced Skooly for logging teacher time, so a regression
// here costs people money. Each test states the rule it protects; if one goes
// red, the fix is almost never "update the expectation".
//
// Run with `npm test`. No dependencies — Node's built-in runner, same spirit as
// the project's use of built-in node:sqlite.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PAY_TIERS,
  TIER_BY_KEY,
  OT_RATE,
  teachingRate,
  tierForPosition,
  rateFor,
  sgDate,
  sgMonth,
  sgTime24,
  sgClock,
  isoFromSg,
  monthLabel,
  shiftMonth,
  minutesBetween,
  crossesSgMidnight,
  isLongSession,
  payCents,
  formatHM,
  decimalHours,
  formatMoney,
} from "../lib/hours/rates.js";

describe("pay tiers", () => {
  test("the four tiers pay 10 / 15 / 20 / 25", () => {
    assert.deepEqual(
      PAY_TIERS.map((t) => [t.key, t.rate]),
      [
        ["asst_probation", 10],
        ["asst", 15],
        ["lead", 20],
        ["lead_ars", 25],
      ]
    );
  });

  test("every tier is reachable by key", () => {
    for (const t of PAY_TIERS) assert.equal(TIER_BY_KEY[t.key], t);
  });

  test("an unset or unknown tier has no rate — never a default", () => {
    // This null is what blocks approval of teaching hours until an admin sets
    // the tier. Returning a fallback number here would silently underpay.
    assert.equal(teachingRate(null), null);
    assert.equal(teachingRate(undefined), null);
    assert.equal(teachingRate(""), null);
    assert.equal(teachingRate("principal"), null);
  });
});

describe("rateFor", () => {
  test("OT is a flat $10 for everyone, whatever the tier", () => {
    assert.equal(OT_RATE, 10);
    for (const t of PAY_TIERS) assert.equal(rateFor("ot", t.key), 10);
    assert.equal(rateFor("ot", null), 10);
  });

  test("teaching pays the teacher's own tier", () => {
    assert.equal(rateFor("teaching", "asst_probation"), 10);
    assert.equal(rateFor("teaching", "asst"), 15);
    assert.equal(rateFor("teaching", "lead"), 20);
    assert.equal(rateFor("teaching", "lead_ars"), 25);
  });

  test("teaching with no tier yields null, not a rate", () => {
    assert.equal(rateFor("teaching", null), null);
  });
});

describe("tierForPosition", () => {
  // The Sheet's free-text positions are messy; the matching order in
  // rates.js is load-bearing. Each case below is a real shape from the import.
  test("INTERN wins over the teacher title it contains", () => {
    assert.equal(tierForPosition("INTERN - ASSISTANT TEACHER"), "asst_probation");
    assert.equal(tierForPosition("Intern - Lead Teacher"), "asst_probation");
  });

  test("ARS beats plain Lead", () => {
    assert.equal(tierForPosition("ARS LEAD TEACHER"), "lead_ars");
    assert.equal(tierForPosition("LEAD TEACHER (ARS CERT)"), "lead_ars");
  });

  test("a dual title takes the higher tier", () => {
    assert.equal(tierForPosition("LEAD TEACHER, ASSISTANT TEACHER"), "lead");
  });

  test("matching is case-insensitive", () => {
    assert.equal(tierForPosition("lead teacher, events team"), "lead");
    assert.equal(tierForPosition("assistant teacher"), "asst");
  });

  test("non-teaching roles stay unset rather than get a teaching rate", () => {
    // Salaried staff (founders, HQ heads, the $300/month interns) must keep a
    // blank teaching rate — see the monthly rate sync in HANDOFF.md §4.
    assert.equal(tierForPosition("ADMIN ASSISTANT"), null, "'ADMIN ASSISTANT' is not 'ASSISTANT TEACHER'");
    assert.equal(tierForPosition("Founder"), null);
    assert.equal(tierForPosition("Finance Head"), null);
    assert.equal(tierForPosition(""), null);
    assert.equal(tierForPosition(null), null);
    assert.equal(tierForPosition(undefined), null);
  });
});

describe("Singapore time (UTC+8, no DST)", () => {
  test("the SG date rolls over at 16:00 UTC, not at midnight UTC", () => {
    // 2026-07-31T17:00Z is already 1 Aug in Singapore. Getting this wrong
    // files a session under the wrong day — and the wrong payroll month.
    assert.equal(sgDate("2026-07-31T17:00:00Z"), "2026-08-01");
    assert.equal(sgDate("2026-07-31T15:59:00Z"), "2026-07-31");
  });

  test("month boundaries follow SG, not UTC", () => {
    assert.equal(sgMonth("2026-07-31T16:00:00Z"), "2026-08");
    assert.equal(sgMonth("2026-08-01T00:00:00Z"), "2026-08");
    assert.equal(sgMonth("2026-07-31T10:00:00Z"), "2026-07");
  });

  test("clock helpers render SG local time", () => {
    assert.equal(sgTime24("2026-07-31T06:05:00Z"), "14:05");
    // Asserted loosely: ICU varies the am/pm casing and may use a narrow
    // no-break space. The contract is a 12-hour SG clock, not the glyphs.
    assert.match(sgClock("2026-07-31T06:05:00Z"), /^2:05\s*[ap]\.?m\.?$/i);
  });

  test("isoFromSg round-trips through the SG wall clock", () => {
    const iso = isoFromSg("2026-07-31", "14:05");
    assert.equal(iso, "2026-07-31T06:05:00.000Z");
    assert.equal(sgDate(iso), "2026-07-31");
    assert.equal(sgTime24(iso), "14:05");
  });

  test("isoFromSg returns null for junk rather than an Invalid Date", () => {
    assert.equal(isoFromSg("not-a-date", "14:05"), null);
  });

  test("month labels and shifts cross year boundaries", () => {
    assert.equal(monthLabel("2026-07"), "July 2026");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2026-07", 0), "2026-07");
  });
});

describe("durations", () => {
  test("minutes are whole and never negative", () => {
    assert.equal(minutesBetween("2026-07-31T09:00:00Z", "2026-07-31T11:30:00Z"), 150);
    // A clock skew or a bad edit must not produce negative pay.
    assert.equal(minutesBetween("2026-07-31T10:00:00Z", "2026-07-31T09:00:00Z"), 0);
    assert.equal(minutesBetween("2026-07-31T09:00:00Z", "2026-07-31T09:00:29Z"), 0);
    assert.equal(minutesBetween("2026-07-31T09:00:00Z", "2026-07-31T09:00:31Z"), 1);
  });

  test("crossing SG midnight is judged in SG, not UTC", () => {
    // Both instants are the same UTC day but straddle SG midnight.
    assert.equal(crossesSgMidnight("2026-07-31T15:00:00Z", "2026-07-31T17:00:00Z"), true);
    assert.equal(crossesSgMidnight("2026-07-31T02:00:00Z", "2026-07-31T06:00:00Z"), false);
  });

  test("a session is flagged long past 12h or across midnight", () => {
    assert.equal(isLongSession("2026-07-31T00:00:00Z", "2026-07-31T12:00:00Z"), false);
    assert.equal(isLongSession("2026-07-31T00:00:00Z", "2026-07-31T12:01:00Z"), true);
    assert.equal(isLongSession("2026-07-31T15:00:00Z", "2026-07-31T17:00:00Z"), true);
  });

  test("a running session (no end) is never flagged", () => {
    assert.equal(isLongSession("2026-07-31T00:00:00Z", null), false);
    assert.equal(isLongSession("2026-07-31T00:00:00Z", undefined), false);
  });
});

describe("pay", () => {
  test("whole hours are exact", () => {
    assert.equal(payCents(60, 15), 1500);
    assert.equal(payCents(90, 20), 3000);
    assert.equal(payCents(120, 25), 5000);
  });

  test("part hours round to a whole cent", () => {
    assert.equal(payCents(7, 15), 175);
    assert.equal(payCents(1, 10), 17); // 16.66… cents
    assert.equal(payCents(5, 15), 125);
    assert.equal(Number.isInteger(payCents(37, 15)), true);
  });

  test("no rate means no pay — never NaN", () => {
    // Pairs with teachingRate(null): an untiered teacher's hours total $0
    // rather than $NaN while they wait for an admin to set the tier.
    assert.equal(payCents(120, null), 0);
    assert.equal(payCents(120, undefined), 0);
  });

  test("zero minutes is zero pay", () => {
    assert.equal(payCents(0, 25), 0);
  });
});

describe("formatting", () => {
  test("formatHM pads the minutes but not the hours", () => {
    assert.equal(formatHM(125), "2h 05m");
    assert.equal(formatHM(60), "1h 00m");
    assert.equal(formatHM(5), "5m");
    assert.equal(formatHM(0), "0m");
    assert.equal(formatHM(-10), "0m");
  });

  test("decimalHours gives 2dp", () => {
    assert.equal(decimalHours(125), 2.08);
    assert.equal(decimalHours(60), 1);
    assert.equal(decimalHours(0), 0);
  });

  test("formatMoney groups thousands and always shows cents", () => {
    assert.equal(formatMoney(123450), "$1,234.50");
    assert.equal(formatMoney(1500), "$15.00");
    assert.equal(formatMoney(0), "$0.00");
    assert.equal(formatMoney(5), "$0.05");
  });
});

describe("end-to-end money, the way payroll sees it", () => {
  test("a 2h05m lead-teacher class", () => {
    const start = isoFromSg("2026-07-31", "14:00");
    const end = isoFromSg("2026-07-31", "16:05");
    const minutes = minutesBetween(start, end);
    assert.equal(minutes, 125);
    assert.equal(formatMoney(payCents(minutes, rateFor("teaching", "lead"))), "$41.67");
  });

  test("the same 2h05m as OT pays the flat rate instead", () => {
    assert.equal(formatMoney(payCents(125, rateFor("ot", "lead"))), "$20.83");
  });

  test("an approved session's snapshot survives a later tier change", () => {
    // Approval stores rate_cents; payroll divides it back out. A promotion
    // afterwards must not rewrite what was already approved.
    const snapshotCents = Math.round(rateFor("teaching", "asst") * 100); // approved as Asst
    const nowLead = rateFor("teaching", "lead"); // promoted since
    assert.equal(payCents(120, snapshotCents / 100), 3000);
    assert.notEqual(payCents(120, nowLead), 3000);
  });
});

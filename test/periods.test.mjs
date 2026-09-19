// Payroll periods and locations.
//
// The period table decides which shifts appear on which payslip, so the tests
// that matter most here are the boring ones: that the transcription from the
// published cut-off table is right, and that the year has no gap or overlap a
// shift could fall through.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PAYROLL_PERIODS_2026,
  cutOffInstant,
  isPastCutOff,
  nextPeriod,
  payRunFor,
  periodByKey,
  periodFor,
  periodRangeLabel,
  periodsForYear,
} from "../lib/hours/periods.js";
import {
  GEOFENCE_RADIUS_M,
  LOCATIONS,
  checkGeofence,
  distanceMetres,
  isFenced,
  locationForSlingName,
  needsCoords,
} from "../lib/hours/locations.js";
import { payrollHours } from "../lib/hours/rates.js";

// ---- rounding, against Karim's five worked examples --------------------

describe("payroll rounding, to the nearest half hour", () => {
  test("all five worked examples", () => {
    assert.equal(payrollHours(5 * 60 + 15), 5.5, "5h15m");
    assert.equal(payrollHours(5 * 60 + 30), 5.5, "5h30m");
    assert.equal(payrollHours(5 * 60 + 10), 5, "5h10m");
    assert.equal(payrollHours(5 * 60 + 45), 6, "5h45m");
    assert.equal(payrollHours(15), 0.5, "15min");
  });

  test("ties at 15 and 45 minutes both round up", () => {
    assert.equal(payrollHours(45), 1);
    assert.equal(payrollHours(75), 1.5);
  });

  test("under fifteen past a mark rounds down", () => {
    assert.equal(payrollHours(14), 0);
    assert.equal(payrollHours(44), 0.5);
  });

  test("zero and negatives cannot produce pay", () => {
    assert.equal(payrollHours(0), 0);
    assert.equal(payrollHours(-90), 0);
  });

  test("always lands on a half hour", () => {
    for (let m = 0; m <= 600; m += 7) {
      assert.equal((payrollHours(m) * 2) % 1, 0, `${m} minutes produced an odd value`);
    }
  });
});

// ---- the published table ----------------------------------------------

describe("2026 cut-off table", () => {
  // Straight from "SLING CUT-OFF DATES 2026 FOR MH/IT HEADS". If a row here
  // disagrees with the printed table, the table wins and this test is the
  // thing that should have caught it.
  const PUBLISHED = [
    ["2026-03-29", "Sun", "2026-03", 23],
    ["2026-04-28", "Tue", "2026-04", 12],
    ["2026-05-26", "Tue", "2026-05", 12],
    ["2026-06-28", "Sun", "2026-06", 12],
    ["2026-07-27", "Tue", "2026-07", 23],
    ["2026-08-25", "Tue", "2026-08", 12],
    ["2026-09-28", "Mon", "2026-09", 12],
    ["2026-10-27", "Tue", "2026-10", 12],
    ["2026-11-24", "Tue", "2026-11", 12],
    ["2026-12-29", "Tue", "2026-12", 12],
  ];

  const weekdayOf = (date) =>
    new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-US", {
      timeZone: "Asia/Singapore",
      weekday: "short",
    });

  test("every cut-off falls on the weekday the table claims, bar the known one", () => {
    for (const [date, weekday, key] of PUBLISHED) {
      if (key === "2026-07") continue; // asserted on its own, below
      assert.equal(weekdayOf(date), weekday, `${key}: ${date} is a ${weekdayOf(date)}, table says ${weekday}`);
    }
  });

  test("KNOWN DISCREPANCY: the July row says Tuesday but 27 July is a Monday", () => {
    // The published table reads "27 July (Tuesday), 11:00 PM". It cannot be
    // both. We keep the DATE and flag the label — see the note in periods.js.
    // If Karim confirms 28 July was meant, change the date there and this test
    // will fail, which is the point: the two must not drift apart quietly.
    assert.equal(weekdayOf("2026-07-27"), "Mon");
    assert.equal(weekdayOf("2026-07-28"), "Tue");
    assert.equal(periodByKey("2026-07").cutOff, "2026-07-27T23:00", "still on the published date");
  });

  test("every cut-off date and hour matches the table", () => {
    assert.equal(PAYROLL_PERIODS_2026.length, PUBLISHED.length);
    PUBLISHED.forEach(([date, , key, hour], i) => {
      const p = PAYROLL_PERIODS_2026[i];
      assert.equal(p.key, key);
      assert.equal(p.cutOff, `${date}T${String(hour).padStart(2, "0")}:00`);
    });
  });

  test("the published salary periods are exactly these", () => {
    assert.deepEqual(
      PAYROLL_PERIODS_2026.map((p) => `${p.from}..${p.to}`),
      [
        "2026-03-01..2026-03-31",
        "2026-04-01..2026-04-30",
        "2026-05-01..2026-05-24",
        "2026-05-25..2026-06-30",
        "2026-07-01..2026-07-26",
        "2026-07-27..2026-08-23",
        "2026-08-24..2026-09-30",
        "2026-10-01..2026-10-25",
        "2026-10-26..2026-11-22",
        "2026-11-23..2026-12-31",
      ]
    );
  });

  test("no gap and no overlap from March to the end of the year", () => {
    const periods = periodsForYear(2026);
    for (let i = 1; i < periods.length; i += 1) {
      const prevEnd = new Date(`${periods[i - 1].to}T12:00:00+08:00`);
      const thisStart = new Date(`${periods[i].from}T12:00:00+08:00`);
      const days = Math.round((thisStart - prevEnd) / 86400000);
      assert.equal(days, 1, `${periods[i - 1].key} -> ${periods[i].key} leaves a ${days}-day gap`);
    }
  });

  test("a cut-off never precedes the period it closes", () => {
    for (const p of PAYROLL_PERIODS_2026) {
      assert.ok(p.cutOff.slice(0, 10) >= p.from, `${p.key} closes before it opens`);
    }
  });
});

// ---- looking a date up -------------------------------------------------

describe("finding a period", () => {
  test("August pay is 27 July to 23 August, not the calendar month", () => {
    assert.equal(periodFor("2026-08-01").key, "2026-08");
    assert.equal(periodFor("2026-07-28").key, "2026-08");
    assert.equal(periodFor("2026-08-24").key, "2026-09");
  });

  test("the boundaries belong to exactly one period each", () => {
    assert.equal(periodFor("2026-07-26").key, "2026-07");
    assert.equal(periodFor("2026-07-27").key, "2026-08");
    assert.equal(periodFor("2026-08-23").key, "2026-08");
  });

  test("dates the table does not cover return null rather than a guess", () => {
    assert.equal(periodFor("2026-01-15"), null);
    assert.equal(periodFor("2026-02-28"), null);
    assert.equal(periodFor("2027-01-05"), null);
    assert.equal(periodFor(null), null);
  });

  test("keys resolve, and the last period has no next", () => {
    assert.equal(periodByKey("2026-08").from, "2026-07-27");
    assert.equal(periodByKey("nope"), null);
    assert.equal(nextPeriod(periodByKey("2026-11")).key, "2026-12");
    assert.equal(nextPeriod(periodByKey("2026-12")), null);
  });

  test("a range reads the way the guide writes it", () => {
    assert.equal(periodRangeLabel(periodByKey("2026-08")), "27 Jul – 23 Aug 2026");
  });
});

// ---- the cut-off -------------------------------------------------------

describe("cut-off", () => {
  const aug = periodByKey("2026-08");

  test("noon Singapore is four in the morning UTC", () => {
    assert.equal(cutOffInstant(aug), "2026-08-25T04:00:00.000Z");
  });

  test("a minute either side of the cut-off", () => {
    assert.equal(isPastCutOff(aug, "2026-08-25T03:59:00Z"), false);
    assert.equal(isPastCutOff(aug, "2026-08-25T04:01:00Z"), true);
  });

  test("a shift entered in time is paid in its own period", () => {
    assert.equal(payRunFor("2026-08-01", "2026-08-20T10:00:00Z").key, "2026-08");
  });

  test("entered after the cut-off, it is carried to the next run", () => {
    // The guide: "Any shifts added after the dateline will be brought forward
    // to the next payroll."
    assert.equal(payRunFor("2026-08-01", "2026-08-26T10:00:00Z").key, "2026-09");
  });

  test("a late entry never re-dates the shift itself", () => {
    assert.equal(periodFor("2026-08-01").key, "2026-08");
  });

  test("past the end of the table it stays put rather than vanishing", () => {
    assert.equal(payRunFor("2026-12-30", "2027-01-05T00:00:00Z").key, "2026-12");
  });

  test("an uncovered date has no pay run at all", () => {
    assert.equal(payRunFor("2026-01-10", "2026-01-11T00:00:00Z"), null);
  });
});

// ---- locations ---------------------------------------------------------

describe("locations", () => {
  test("six fenced centres, two placeless", () => {
    assert.equal(LOCATIONS.filter((l) => l.fenced).length, 6);
    assert.deepEqual(
      LOCATIONS.filter((l) => !l.fenced).map((l) => l.key),
      ["outside", "online"]
    );
  });

  test("every fenced centre carries a postal code to geocode from", () => {
    for (const l of LOCATIONS.filter((x) => x.fenced)) {
      assert.match(l.postalCode, /^\d{6}$/, `${l.key} has no usable postal code`);
    }
  });

  test("Sling's own names resolve", () => {
    assert.equal(locationForSlingName("LQK WDSQ 1 (78)").key, "wdsq_1");
    assert.equal(locationForSlingName("  outside lqk  ").key, "outside");
    assert.equal(locationForSlingName("Nowhere"), null);
  });

  test("Outside LQK and Online are unfenced", () => {
    assert.equal(isFenced("outside"), false);
    assert.equal(isFenced("online"), false);
    assert.equal(isFenced("wdsq_1"), true);
  });
});

describe("geofence", () => {
  // Woods Square, roughly. Only the maths is under test here, not the pin.
  const centre = { key: "wdsq_1", fenced: true, lat: 1.4364, lng: 103.7866 };

  test("unfenced locations wave everyone through", () => {
    const online = { key: "online", fenced: false };
    assert.equal(checkGeofence(online, null).ok, true);
    assert.equal(checkGeofence(online, null).reason, "unfenced");
  });

  test("inside the radius passes", () => {
    const r = checkGeofence(centre, { lat: 1.4366, lng: 103.787 });
    assert.equal(r.ok, true);
    assert.ok(r.metres < GEOFENCE_RADIUS_M);
  });

  test("a kilometre and a half away is refused as too far", () => {
    const r = checkGeofence(centre, { lat: 1.4500, lng: 103.7866 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "too_far");
    assert.ok(r.metres > GEOFENCE_RADIUS_M);
  });

  test("no GPS fix is its own refusal, not 'too far'", () => {
    assert.equal(checkGeofence(centre, null).reason, "no_fix");
    assert.equal(checkGeofence(centre, { lat: NaN, lng: 103.7 }).reason, "no_fix");
  });

  test("an unresolved centre REFUSES rather than falling through to unfenced", () => {
    const unresolved = { key: "primz", fenced: true, lat: null, lng: null };
    assert.equal(needsCoords(unresolved), true);
    const r = checkGeofence(unresolved, { lat: 1.4364, lng: 103.7866 });
    assert.equal(r.ok, false, "a missing pin must never silently disable the fence");
    assert.equal(r.reason, "no_coords");
  });

  test("haversine agrees with a known distance", () => {
    // One degree of latitude is ~111.2 km anywhere on the globe.
    const d = distanceMetres({ lat: 1.0, lng: 103.8 }, { lat: 2.0, lng: 103.8 });
    assert.ok(Math.abs(d - 111195) < 200, `got ${Math.round(d)}m`);
  });

  test("distance is symmetric and zero at the same point", () => {
    const a = { lat: 1.4364, lng: 103.7866 };
    const b = { lat: 1.3521, lng: 103.8198 };
    assert.equal(Math.round(distanceMetres(a, b)), Math.round(distanceMetres(b, a)));
    assert.equal(distanceMetres(a, a), 0);
  });
});

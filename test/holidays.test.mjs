// Singapore public holidays imported from MOM's data.gov.sg dataset.
//
// The live fetch is opt-in, like the Nominatim one in geo.test.mjs:
//   LQK_TEST_NETWORK=1 npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { toHoliday, holidayMap, fetchHolidays, DATASET_CONSOLIDATED } from "../lib/hours/holidays.js";

describe("parsing a dataset record", () => {
  test("keeps a good record", () => {
    assert.deepEqual(toHoliday({ date: "2026-08-09", holiday: "National Day" }), {
      date: "2026-08-09",
      name: "National Day",
    });
  });

  test("normalises the typographic apostrophe the feed actually sends", () => {
    // The live feed sends "New Year’s Day" (U+2019). Left as-is it would never
    // compare equal to a name typed anywhere else.
    assert.equal(toHoliday({ date: "2026-01-01", holiday: "New Year’s Day" }).name, "New Year's Day");
  });

  test("keeps the observed-day suffix — it is a separate paid holiday", () => {
    assert.equal(
      toHoliday({ date: "2026-08-10", holiday: "National Day (Observed)" }).name,
      "National Day (Observed)"
    );
  });

  test("rejects anything unusable rather than storing a bad date", () => {
    assert.equal(toHoliday({ date: "9 Aug 2026", holiday: "National Day" }), null);
    assert.equal(toHoliday({ date: "2026-08-09", holiday: "" }), null);
    assert.equal(toHoliday({ date: "", holiday: "National Day" }), null);
    assert.equal(toHoliday({}), null);
    assert.equal(toHoliday(null), null);
  });

  test("trims whitespace", () => {
    assert.deepEqual(toHoliday({ date: " 2026-08-09 ", holiday: " National Day " }), {
      date: "2026-08-09",
      name: "National Day",
    });
  });
});

describe("holidayMap", () => {
  test("keys stored rows by date for a same-day lookup", () => {
    const m = holidayMap([
      { date: "2026-01-01", name: "New Year's Day" },
      { date: "2026-08-09", name: "National Day" },
    ]);
    assert.equal(m.get("2026-08-09"), "National Day");
    assert.equal(m.get("2026-08-10"), undefined);
    assert.equal(m.size, 2);
  });

  test("empty input is an empty map, not a throw", () => {
    assert.equal(holidayMap([]).size, 0);
    assert.equal(holidayMap(null).size, 0);
  });
});

describe("live MOM feed", { skip: !process.env.LQK_TEST_NETWORK }, () => {
  test("returns sorted Singapore holidays covering the current year", async () => {
    const rows = await fetchHolidays(DATASET_CONSOLIDATED);
    assert.ok(rows.length > 50, `expected a full history, got ${rows.length}`);
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    assert.deepEqual(rows, sorted, "expected the feed to come back sorted");
    // National Day is 9 August every year — a good canary that the shape held.
    assert.ok(
      rows.some((r) => r.date.endsWith("-08-09") && r.name === "National Day"),
      "expected National Day on 9 August"
    );
  });

  test("a bad resource id throws rather than silently returning nothing", async () => {
    await assert.rejects(() => fetchHolidays("not-a-real-resource-id"));
  });
});

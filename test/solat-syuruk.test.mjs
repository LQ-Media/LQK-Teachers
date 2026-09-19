// Syuruk (sunrise) on the prayer timetables.
//
// Two things are easy to get wrong here and both are invisible in a diff.
//
// First, the Aladhan API appends the zone to every time — "05:47 (+08)" — so
// anything that reads a timing has to strip it. The dashboard widget used to
// split on ":" and render the raw string, which happens to parse but shows the
// suffix to the reader.
//
// Second, Syuruk is NOT a prayer. It closes Subuh's window, has no azan, and
// must never appear in the azan settings shape or the server's push schedule.
// PRAYER_KEYS is what both of those iterate, so it staying at five is the
// invariant that keeps a teacher from being woken by a sunrise notification.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PRAYER_KEYS,
  SUNRISE,
  timeLabel,
  timeMinutes,
  defaultPrayers,
  sanitizePrayers,
} from "../lib/azan/catalog.js";

describe("Aladhan time parsing", () => {
  test("strips the zone suffix the API appends", () => {
    assert.equal(timeLabel("05:47 (+08)"), "05:47");
    assert.equal(timeMinutes("05:47 (+08)"), 5 * 60 + 47);
  });

  test("handles a bare time too", () => {
    assert.equal(timeLabel("19:03"), "19:03");
    assert.equal(timeMinutes("19:03"), 19 * 60 + 3);
  });

  test("pads a single-digit hour so the column stays aligned", () => {
    assert.equal(timeLabel("7:04 (+08)"), "07:04");
    assert.equal(timeMinutes("7:04"), 7 * 60 + 4);
  });

  test("returns null rather than a bogus 00:00 for missing or junk input", () => {
    for (const bad of [undefined, null, "", "  ", "not a time", "25:00", "10:60"]) {
      assert.equal(timeMinutes(bad), null, `timeMinutes(${JSON.stringify(bad)})`);
      assert.equal(timeLabel(bad), null, `timeLabel(${JSON.stringify(bad)})`);
    }
  });

  test("midnight is 0 minutes, not a falsy hole", () => {
    assert.equal(timeMinutes("00:00 (+08)"), 0);
    assert.equal(timeLabel("00:00 (+08)"), "00:00");
  });
});

describe("Syuruk is a reference time, never a prayer", () => {
  test("it is not in PRAYER_KEYS", () => {
    assert.equal(PRAYER_KEYS.length, 5);
    assert.ok(!PRAYER_KEYS.includes(SUNRISE.key));
    assert.deepEqual(PRAYER_KEYS, ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]);
  });

  test("it reads from the API's own Sunrise key", () => {
    assert.equal(SUNRISE.key, "Sunrise");
    assert.equal(SUNRISE.label, "Syuruk");
  });

  test("it gets no slot in the stored azan settings", () => {
    const prayers = defaultPrayers();
    assert.equal(Object.keys(prayers).length, 5);
    assert.equal(prayers[SUNRISE.key], undefined);
  });

  test("a client cannot smuggle it in through the settings endpoint", () => {
    const clean = sanitizePrayers({
      Fajr: { enabled: true, sound: "fajr" },
      Sunrise: { enabled: true, sound: "makkah" },
    });
    assert.equal(clean[SUNRISE.key], undefined);
    assert.equal(clean.Fajr.enabled, true);
  });
});

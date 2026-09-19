// The clock-in geofence: the bridge from a shift's branch to a fence, and what
// that fence decides.
//
// The bug this file is mostly guarding against is a SILENT FALL-THROUGH — a
// case that should refuse quietly behaving like "no fence" and waving everyone
// past. So most of these tests assert a refusal, and the few that assert an
// allow say why that allow is deliberate.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GEOFENCE_RADIUS_M,
  LOCATION_BY_KEY,
  SHIFT_LOCATIONS,
  checkGeofence,
  distanceMetres,
  isFenced,
  locationForBranch,
  needsCoords,
  unfencedBranch,
} from "../lib/hours/locations.js";
import { LOCATIONS as BRANCHES } from "../lib/locations.js";

// Real Singapore coordinates, used only as test fixtures — the running system
// resolves these from OneMap and never reads them from source.
const WOODS_SQUARE = { lat: 1.43608, lng: 103.78554 };
const TAMPINES_JUNCTION = { lat: 1.35406, lng: 103.94318 };
const fenced = (key, at) => ({ ...LOCATION_BY_KEY[key], ...at });

describe("the branch bridge", () => {
  test("every real branch resolves to something", () => {
    // A branch that resolved to null would refuse every clock-in there.
    for (const b of BRANCHES) {
      assert.notEqual(locationForBranch(b), null, `${b} resolved to null`);
    }
  });

  test("the four teaching centres are fenced", () => {
    for (const b of ["Woods Square", "Primz Bizhub", "Tampines Blk 462", "Tampines Junction"]) {
      const loc = locationForBranch(b);
      assert.equal(loc.fenced, true, `${b} is not fenced`);
      assert.match(loc.postalCode, /^\d{6}$/, `${b} has no postal code to geocode`);
    }
  });

  test("HQ, Outside LQK and Online are unfenced BY DECLARATION", () => {
    // Not by accident, and not by failing to find coordinates — there is a
    // difference, and it is the whole point of this module.
    for (const b of ["HQ", "Outside LQK", "Online"]) {
      assert.equal(unfencedBranch(b), true, `${b} should be declared unfenced`);
      assert.equal(locationForBranch(b).fenced, false);
    }
  });

  test("a shift with no branch is unfenced, not refused", () => {
    // There is no place on the record, so there is nothing a fence could
    // compare against. Refusing would punish a teacher for an admin's blank.
    for (const empty of [null, undefined, ""]) {
      assert.equal(unfencedBranch(empty), true);
      assert.equal(locationForBranch(empty).fenced, false);
    }
  });

  test("an unrecognised branch returns null — which callers must REFUSE on", () => {
    // The dangerous case. A typo'd branch must not read as "no fence".
    for (const junk of ["Woodlands", "woods square", "Tampines", "HQ2", "  "]) {
      assert.equal(locationForBranch(junk), null, `${JSON.stringify(junk)} should not resolve`);
    }
  });

  test("SHIFT_LOCATIONS is the branches plus the two placeless ones", () => {
    for (const b of BRANCHES) assert.ok(SHIFT_LOCATIONS.includes(b), `${b} missing from SHIFT_LOCATIONS`);
    assert.ok(SHIFT_LOCATIONS.includes("Outside LQK"));
    assert.ok(SHIFT_LOCATIONS.includes("Online"));
  });

  test("every SHIFT_LOCATION resolves — no entry in the list the fence cannot read", () => {
    for (const b of SHIFT_LOCATIONS) {
      assert.notEqual(locationForBranch(b), null, `${b} is offered but does not resolve`);
    }
  });
});

describe("the fence itself", () => {
  test("a teacher at the centre is let in", () => {
    const r = checkGeofence(fenced("wdsq_1", WOODS_SQUARE), WOODS_SQUARE);
    assert.equal(r.ok, true);
    assert.equal(r.reason, "inside");
    assert.ok(r.metres < 5);
  });

  test("a teacher across the island is not", () => {
    const r = checkGeofence(fenced("wdsq_1", WOODS_SQUARE), TAMPINES_JUNCTION);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "too_far");
    assert.ok(r.metres > 15000, `${r.metres}`);
  });

  test("the radius is a kilometre and the edge behaves", () => {
    assert.equal(GEOFENCE_RADIUS_M, 1000);
    // ~0.0090° of latitude is almost exactly 1 km.
    const justInside = { lat: WOODS_SQUARE.lat + 0.0085, lng: WOODS_SQUARE.lng };
    const wellOutside = { lat: WOODS_SQUARE.lat + 0.0200, lng: WOODS_SQUARE.lng };
    assert.equal(checkGeofence(fenced("wdsq_1", WOODS_SQUARE), justInside).ok, true);
    assert.equal(checkGeofence(fenced("wdsq_1", WOODS_SQUARE), wellOutside).ok, false);
  });

  test("an UNRESOLVED centre refuses — it never falls through to unfenced", () => {
    // The single most important test in this file. A failed geocode must not
    // quietly disable the check for everybody.
    const loc = LOCATION_BY_KEY.wdsq_1; // no lat/lng attached
    assert.equal(needsCoords(loc), true);
    const r = checkGeofence(loc, WOODS_SQUARE);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_coords");
  });

  test("a phone with no fix is a distinct refusal, not 'too far'", () => {
    // The caller allows this one through; it must stay distinguishable so that
    // decision is made deliberately rather than by lumping it in with too_far.
    for (const bad of [null, undefined, {}, { lat: "x", lng: "y" }, { lat: NaN, lng: 1 }]) {
      const r = checkGeofence(fenced("wdsq_1", WOODS_SQUARE), bad);
      assert.equal(r.ok, false);
      assert.equal(r.reason, "no_fix");
    }
  });

  test("the placeless locations let anyone in from anywhere", () => {
    for (const key of ["outside", "online"]) {
      assert.equal(isFenced(key), false);
      const r = checkGeofence(LOCATION_BY_KEY[key], TAMPINES_JUNCTION);
      assert.equal(r.ok, true);
      assert.equal(r.reason, "unfenced");
    }
  });

  test("an unfenced location is allowed even with no fix at all", () => {
    assert.equal(checkGeofence(LOCATION_BY_KEY.online, null).ok, true);
  });
});

describe("distance", () => {
  test("zero to itself", () => {
    assert.equal(Math.round(distanceMetres(WOODS_SQUARE, WOODS_SQUARE)), 0);
  });

  test("Woods Square to Tampines Junction is about 18 km", () => {
    const d = distanceMetres(WOODS_SQUARE, TAMPINES_JUNCTION);
    assert.ok(d > 17000 && d < 20000, `${Math.round(d)} m`);
  });

  test("symmetric", () => {
    assert.equal(
      Math.round(distanceMetres(WOODS_SQUARE, TAMPINES_JUNCTION)),
      Math.round(distanceMetres(TAMPINES_JUNCTION, WOODS_SQUARE))
    );
  });

  test("a missing point is infinitely far, never zero", () => {
    // Returning 0 would put a missing location INSIDE every fence.
    assert.equal(distanceMetres(null, WOODS_SQUARE), Infinity);
    assert.equal(distanceMetres(WOODS_SQUARE, null), Infinity);
  });
});

describe("the three Woods Square rooms", () => {
  test("share one postal code, so one coordinate serves all three", () => {
    const codes = new Set(["wdsq_1", "wdsq_2", "wdsq_3"].map((k) => LOCATION_BY_KEY[k].postalCode));
    assert.equal(codes.size, 1);
  });

  test("and the branch maps to one of them", () => {
    assert.match(locationForBranch("Woods Square").key, /^wdsq_/);
  });
});

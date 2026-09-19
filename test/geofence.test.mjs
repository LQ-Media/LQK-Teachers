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
  SHIFT_LOCATIONS_ALL,
  LEGACY_SHIFT_LOCATIONS,
  shiftLocationsForBranch,
  expandManagedBranches,
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

  test("every person-branch is COVERED by a shift location", () => {
    // Not "appears verbatim in SHIFT_LOCATIONS", which is what this asserted
    // until 17 Sep. Woods Square became its three rooms on the shift form, so
    // a branch is now covered rather than named — and every one of the
    // locations it expands to still has to resolve, or a teacher based there
    // could be rostered somewhere with no fence.
    for (const b of BRANCHES) {
      const covers = shiftLocationsForBranch(b);
      assert.ok(covers.length, `${b} covers no shift location at all`);
      for (const l of covers) {
        assert.ok(
          SHIFT_LOCATIONS_ALL.includes(l),
          `${b} expands to ${l}, which is not a valid shift location`
        );
      }
    }
    assert.ok(SHIFT_LOCATIONS.includes("Outside LQK"));
    assert.ok(SHIFT_LOCATIONS.includes("Online"));
  });

  test("every SHIFT_LOCATION resolves — no entry in the list the fence cannot read", () => {
    for (const b of SHIFT_LOCATIONS) {
      assert.notEqual(locationForBranch(b), null, `${b} is offered but does not resolve`);
    }
  });

  test("the pre-split 'Woods Square' still resolves, so old shifts keep a fence", () => {
    // Dropping it would have been quietly destructive: locationForBranch
    // returns null for an unrecognised branch, every caller reads null as
    // "cannot vouch" and REFUSES, so with the fence on every clock-in at the
    // shifts already rostered would have started failing.
    for (const legacy of LEGACY_SHIFT_LOCATIONS) {
      const loc = locationForBranch(legacy);
      assert.notEqual(loc, null, `${legacy} no longer resolves`);
      assert.equal(loc.fenced, true, `${legacy} must still be fenced, not waved through`);
    }
  });

  test("it is NOT offered for a new shift", () => {
    for (const legacy of LEGACY_SHIFT_LOCATIONS) {
      assert.ok(!SHIFT_LOCATIONS.includes(legacy), `${legacy} should not be on the menu`);
      assert.ok(SHIFT_LOCATIONS_ALL.includes(legacy), `${legacy} should still be valid`);
    }
  });
});

describe("Woods Square, split into its three rooms", () => {
  const ROOMS = ["Woods Square 1 (#03-78)", "Woods Square 2 (#03-79)", "Woods Square 3 (#03-77)"];

  test("all three are offered, and all three are fenced", () => {
    for (const r of ROOMS) {
      assert.ok(SHIFT_LOCATIONS.includes(r), `${r} is not offered`);
      assert.equal(locationForBranch(r)?.fenced, true, `${r} is not fenced`);
    }
  });

  test("they share one postal code, so one coordinate serves all three", () => {
    const codes = new Set(ROOMS.map((r) => locationForBranch(r).postalCode));
    assert.equal(codes.size, 1);
    assert.equal([...codes][0], "737715");
  });

  test("each maps to its OWN Sling room, not all to the first", () => {
    // They share a coordinate but not an identity: the roster says which room,
    // and an import matches Sling's per-room names.
    assert.deepEqual(ROOMS.map((r) => locationForBranch(r).key), ["wdsq_1", "wdsq_2", "wdsq_3"]);
  });

  test("managing 'Woods Square' covers all three rooms AND the old name", () => {
    // The breakage this prevents: canManageBranch does an exact match, so
    // without the expansion the three Woods Square IT Heads silently lost the
    // whole centre's roster and were left with an empty location dropdown.
    const covered = shiftLocationsForBranch("Woods Square");
    for (const r of ROOMS) assert.ok(covered.includes(r), `${r} not covered`);
    assert.ok(covered.includes("Woods Square"), "the pre-split name must stay covered");
  });

  test("managing a room does not leak the rest of the centre", () => {
    // Nobody is assigned a room today — manager_branches holds person-branches
    // — but if that ever changes, a room must not silently widen to the centre.
    assert.deepEqual(shiftLocationsForBranch(ROOMS[0]), [ROOMS[0]]);
  });

  test("another centre is unaffected by the split", () => {
    assert.deepEqual(shiftLocationsForBranch("Primz Bizhub"), ["Primz Bizhub"]);
    assert.deepEqual(shiftLocationsForBranch("Tampines Junction"), ["Tampines Junction"]);
  });

  test("a full admin's null scope passes straight through", () => {
    // Callers rely on "null = everything"; turning it into [] would have
    // hidden every shift from every full admin.
    assert.equal(expandManagedBranches(null), null);
    assert.equal(expandManagedBranches(undefined), null);
  });

  test("an empty managed list stays empty, and is not widened to everything", () => {
    // A centre admin with no centres assigned sees nothing. That is the safe
    // direction, and the opposite would hand them the company.
    assert.deepEqual(expandManagedBranches([]), []);
  });

  test("two managed branches expand without duplicates", () => {
    const out = expandManagedBranches(["Woods Square", "Primz Bizhub", "Woods Square"]);
    assert.equal(new Set(out).size, out.length);
    assert.ok(out.includes("Woods Square 2 (#03-79)"));
    assert.ok(out.includes("Primz Bizhub"));
  });

  test("a blank or unknown branch covers nothing rather than everything", () => {
    assert.deepEqual(shiftLocationsForBranch(""), []);
    assert.deepEqual(shiftLocationsForBranch(null), []);
    assert.deepEqual(shiftLocationsForBranch("Atlantis"), ["Atlantis"], "unknown passes through as itself");
  });

  test("the room names carry no comma, so a CSV export cannot split on them", () => {
    // shifts.branch lands in the payroll CSV and in GROUP_CONCAT lists.
    for (const r of [...ROOMS, ...SHIFT_LOCATIONS]) {
      assert.ok(!/[,|;]/.test(r), `${r} contains a separator`);
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

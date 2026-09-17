// Reading the geofence's recorded verdicts, and the switch that depends on it.
//
// These tests exist because of what the switch does. With the fence on, a
// clock-in that fails is REFUSED, and no clock-in means no pay — so the report
// that talks somebody into throwing it has to be right about one number above
// all: how many real, recorded taps would have been turned away.
//
// The interesting cases are the ones where an honest count and a reassuring
// count differ:
//   • no_fix is recorded and never refused, so counting it as a block would
//     overstate the risk and talk somebody out of a switch that is fine;
//   • unfenced taps are not evidence about a fence, so counting them as
//     "would have gone through" would pad the good news;
//   • a session from before the fence existed has no verdict at all and must
//     not be bucketed as anything.
//
// Run under both timezones: the window labels are Singapore dates.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  BLOCKING_REASONS,
  wouldBlock,
  metresLabel,
  reasonLabel,
  summariseVerdicts,
  readinessOf,
} from "../lib/hours/fence-report.js";
import { LOCATIONS, checkGeofence, GEOFENCE_RADIUS_M } from "../lib/hours/locations.js";

const row = (reason, extra = {}) => ({
  reason,
  metres: null,
  at: "2026-09-17T02:00:00.000Z",
  branch: "Woods Square",
  teacher: "Nur Aisyah",
  ...extra,
});

describe("which verdicts actually refuse", () => {
  test("too far, no coordinates and an unknown branch block", () => {
    assert.equal(wouldBlock("too_far"), true);
    assert.equal(wouldBlock("no_coords"), true);
    assert.equal(wouldBlock("unknown_branch"), true);
  });

  test("a phone with no fix is NEVER counted as a block", () => {
    // The rule this file exists to protect. geofenceRefusal() returns null for
    // no_fix, so a no_fix tap goes through even with the fence on — every
    // centre is on an upper floor where GPS is at its worst, and blocking pay
    // for a bad fix would punish the teacher for their building.
    assert.equal(wouldBlock("no_fix"), false);
  });

  test("inside and unfenced do not block", () => {
    assert.equal(wouldBlock("inside"), false);
    assert.equal(wouldBlock("unfenced"), false);
  });

  test("an unknown or missing reason does not block", () => {
    assert.equal(wouldBlock(""), false);
    assert.equal(wouldBlock(null), false);
    assert.equal(wouldBlock(undefined), false);
    assert.equal(wouldBlock("something_new"), false);
  });

  test("every reason checkGeofence can actually return is accounted for", () => {
    // If checkGeofence gains a reason, this fails until somebody decides
    // whether it blocks — which is the decision that must not be made by
    // default.
    const known = new Set(["inside", "too_far", "no_fix", "no_coords", "unfenced", "unknown_branch"]);
    const centre = LOCATIONS.find((l) => l.fenced);
    const seen = new Set([
      checkGeofence({ ...centre, lat: 1.3, lng: 103.8 }, { lat: 1.3, lng: 103.8 }).reason,
      checkGeofence({ ...centre, lat: 1.3, lng: 103.8 }, { lat: 1.45, lng: 103.95 }).reason,
      checkGeofence({ ...centre, lat: 1.3, lng: 103.8 }, null).reason,
      checkGeofence(centre, { lat: 1.3, lng: 103.8 }).reason,
      checkGeofence({ key: "online", fenced: false }, null).reason,
    ]);
    for (const r of seen) assert.ok(known.has(r), `checkGeofence returned an unhandled reason: ${r}`);
    for (const r of BLOCKING_REASONS) {
      assert.ok(known.has(r), `${r} is called blocking but checkGeofence never returns it`);
    }
  });
});

describe("summarising", () => {
  test("no rows at all is zero, not a crash", () => {
    const s = summariseVerdicts([]);
    assert.equal(s.total, 0);
    assert.equal(s.fenced, 0);
    assert.equal(s.blocked, 0);
    assert.deepEqual(s.perCentre, []);
    assert.deepEqual(s.blocking, []);
  });

  test("null and undefined input are the same as none", () => {
    assert.equal(summariseVerdicts(null).total, 0);
    assert.equal(summariseVerdicts(undefined).total, 0);
  });

  test("a session with NO recorded verdict is dropped, not assumed good", () => {
    // Sessions from before the fence existed have geo_fence NULL. Counting one
    // as "inside" would make the report lie in the reassuring direction.
    const s = summariseVerdicts([row("inside"), { reason: null, metres: null }, { reason: "" }]);
    assert.equal(s.total, 1);
  });

  test("the blocked count is the refusals only", () => {
    const s = summariseVerdicts([
      row("inside", { metres: 40 }),
      row("inside", { metres: 120 }),
      row("no_fix"),
      row("too_far", { metres: 19800 }),
      row("no_coords"),
    ]);
    assert.equal(s.total, 5);
    assert.equal(s.fenced, 5);
    assert.equal(s.blocked, 2, "no_fix must not be counted");
    assert.equal(s.noFix, 1);
  });

  test("unfenced taps count in the total but not in the fenced denominator", () => {
    // Otherwise a month of Online meetings would dilute the percentage and make
    // a real problem at a centre look small.
    const s = summariseVerdicts([
      row("unfenced", { branch: "Online" }),
      row("unfenced", { branch: "HQ" }),
      row("too_far", { metres: 5000 }),
    ]);
    assert.equal(s.total, 3);
    assert.equal(s.fenced, 1);
    assert.equal(s.blocked, 1);
  });

  test("unfenced taps get no row in the per-centre table", () => {
    const s = summariseVerdicts([row("unfenced", { branch: "Online" }), row("inside", { metres: 10 })]);
    assert.deepEqual(s.perCentre.map((c) => c.branch), ["Woods Square"]);
  });

  test("per centre, the furthest ACCEPTED distance is reported", () => {
    // This is the number that says whether a kilometre is comfortable: if real
    // accepted taps are landing at 900 m, the fence is one bad fix from
    // refusing somebody who is at work.
    const s = summariseVerdicts([
      row("inside", { metres: 50 }),
      row("inside", { metres: 910 }),
      row("inside", { metres: 200 }),
      row("too_far", { metres: 4000 }),
    ]);
    const ws = s.perCentre.find((c) => c.branch === "Woods Square");
    assert.equal(ws.maxInsideM, 910);
    assert.equal(ws.worstM, 4000, "the worst REFUSED distance is kept separately");
  });

  test("a centre with no accepted tap reports no furthest-accepted", () => {
    const s = summariseVerdicts([row("too_far", { metres: 3000 })]);
    assert.equal(s.perCentre[0].maxInsideM, null);
  });

  test("centres are split out and sorted worst first", () => {
    const s = summariseVerdicts([
      row("inside", { branch: "Tampines Junction", metres: 30 }),
      row("inside", { branch: "Tampines Junction", metres: 60 }),
      row("inside", { branch: "Tampines Junction", metres: 90 }),
      row("too_far", { branch: "Primz Bizhub", metres: 2000 }),
    ]);
    assert.deepEqual(s.perCentre.map((c) => c.branch), ["Primz Bizhub", "Tampines Junction"]);
    assert.equal(s.perCentre[0].blocked, 1);
    assert.equal(s.perCentre[1].taps, 3);
  });

  test("a blank branch is bucketed by name rather than dropped", () => {
    // An unknown_branch verdict usually HAS no branch — that is why it refused.
    // Dropping it would hide the one row an admin needs to go and fix.
    const s = summariseVerdicts([row("unknown_branch", { branch: null })]);
    assert.equal(s.perCentre[0].branch, "No location");
    assert.equal(s.blocked, 1);
  });

  test("the blocking list is furthest first, and names the person", () => {
    const s = summariseVerdicts([
      row("too_far", { metres: 1200, teacher: "Near Miss" }),
      row("too_far", { metres: 19800, teacher: "Across The Island" }),
      row("no_coords", { teacher: "Unresolved Centre" }),
    ]);
    assert.equal(s.blocking.length, 3);
    assert.deepEqual(s.blocking.map((b) => b.teacher), ["Across The Island", "Near Miss", "Unresolved Centre"]);
  });

  test("the window spans the oldest and newest recorded tap", () => {
    const s = summariseVerdicts([
      row("inside", { at: "2026-09-10T01:00:00.000Z" }),
      row("inside", { at: "2026-09-17T09:00:00.000Z" }),
      row("inside", { at: "2026-09-12T01:00:00.000Z" }),
    ]);
    assert.equal(s.window.from, "2026-09-10T01:00:00.000Z");
    assert.equal(s.window.to, "2026-09-17T09:00:00.000Z");
  });

  test("a tap with no timestamp does not collapse the window", () => {
    const s = summariseVerdicts([row("no_fix", { at: null }), row("inside", { at: "2026-09-17T09:00:00.000Z" })]);
    assert.equal(s.window.from, "2026-09-17T09:00:00.000Z");
    assert.equal(s.window.to, "2026-09-17T09:00:00.000Z");
  });
});

describe("whether it is safe to switch on", () => {
  test("an unresolved centre blocks the switch and names it", () => {
    const r = readinessOf(summariseVerdicts([row("inside", { metres: 10 })]), ["Primz Bizhub"]);
    assert.equal(r.state, "blocked");
    assert.equal(r.canEnable, false);
    assert.match(r.message, /Primz Bizhub/);
  });

  test("several unresolved centres read as plural", () => {
    const r = readinessOf(summariseVerdicts([]), ["Primz Bizhub", "Tampines 462"]);
    assert.match(r.message, /2 centres still have no coordinates/);
  });

  test("an unresolved centre wins even when every recorded tap was clean", () => {
    // Order matters: coordinates missing is the one state where the switch is
    // refused outright, and a wall of green ticks must not bury it.
    const clean = summariseVerdicts([row("inside", { metres: 10 }), row("inside", { metres: 20 })]);
    assert.equal(readinessOf(clean, ["Tampines 462"]).canEnable, false);
  });

  test("resolved but nothing recorded says so, rather than showing a tick", () => {
    const r = readinessOf(summariseVerdicts([]), []);
    assert.equal(r.state, "no_data");
    assert.equal(r.canEnable, true, "allowed — just untested");
    assert.match(r.message, /no clock-in has been recorded/);
  });

  test("a month of Online-only taps is still no data about the fence", () => {
    const r = readinessOf(summariseVerdicts([row("unfenced", { branch: "Online" })]), []);
    assert.equal(r.state, "no_data");
  });

  test("refusals put it in review, with the count and the percentage", () => {
    const rows = [...Array(9)].map(() => row("inside", { metres: 20 }));
    rows.push(row("too_far", { metres: 4000 }));
    const r = readinessOf(summariseVerdicts(rows), []);
    assert.equal(r.state, "review");
    assert.equal(r.canEnable, true, "allowed with eyes open, not forbidden");
    assert.match(r.message, /1 of 10 recorded clock-ins \(10%\)/);
  });

  test("all clean reads as ready", () => {
    const r = readinessOf(summariseVerdicts([row("inside", { metres: 20 }), row("inside", { metres: 30 })]), []);
    assert.equal(r.state, "ready");
    assert.equal(r.canEnable, true);
    assert.match(r.message, /All 2 recorded clock-ins/);
  });

  test("clean but full of bad fixes says the fence would not have checked them", () => {
    // "Ready" with 8 of 10 taps unlocatable is technically true and useless on
    // its own — the fence would wave those eight through either way.
    const rows = [...Array(8)].map(() => row("no_fix"));
    rows.push(row("inside", { metres: 20 }), row("inside", { metres: 30 }));
    const r = readinessOf(summariseVerdicts(rows), []);
    assert.equal(r.state, "ready");
    assert.match(r.message, /8 of them had no location/);
  });
});

describe("how it reads to a person", () => {
  test("metres up close, kilometres beyond one", () => {
    assert.equal(metresLabel(0), "0 m");
    assert.equal(metresLabel(42.4), "42 m");
    assert.equal(metresLabel(999), "999 m");
    assert.equal(metresLabel(1000), "1.0 km");
    assert.equal(metresLabel(19800), "19.8 km");
  });

  test("an unknown distance is a dash, never 0 m", () => {
    // "0 m away" for a tap whose distance was never measured would read as
    // "standing in the classroom", which is the opposite of the truth.
    assert.equal(metresLabel(null), "—");
    assert.equal(metresLabel(undefined), "—");
    assert.equal(metresLabel(Infinity), "—");
    assert.equal(metresLabel(NaN), "—");
  });

  test("the radius the fence actually uses reads as 1.0 km", () => {
    assert.equal(metresLabel(GEOFENCE_RADIUS_M), "1.0 km");
  });

  test("every verdict has words a person can read", () => {
    for (const r of ["inside", "too_far", "no_fix", "no_coords", "unknown_branch", "unfenced"]) {
      const label = reasonLabel(r);
      assert.ok(label && label !== r, `${r} has no human label`);
    }
  });

  test("an unrecognised verdict falls back to itself rather than to nothing", () => {
    assert.equal(reasonLabel("something_new"), "something_new");
    assert.equal(reasonLabel(null), "Unknown");
  });
});

// ---- The stored state, against a real database -------------------------
//
// lib/hours/geocode.js is "server-only" and imports through "@/", so the SQL
// behind the switch is mirrored here against a real database built by the real
// migration. Two things are worth pinning: OFF is the default (a fence that
// defaults on before its coordinates exist would refuse every clock-in on the
// first morning), and ON is refused while any centre is unresolved.

let db;
let dir;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "lqk-fence-"));
  process.env.LQK_DATA_DIR = dir;
  process.env.NODE_ENV = "production";
  const mod = await import("../lib/db.js");
  db = mod.getDb();
});

after(() => rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  db.exec("DELETE FROM geofence_log");
  db.exec("DELETE FROM location_coords");
  db.exec("DELETE FROM kv WHERE key = 'geofence_enabled'");
});

const fencedKeys = () => LOCATIONS.filter((l) => l.fenced).map((l) => l.key);

/** Mirrors geofenceEnabled(). */
function isOn() {
  return db.prepare("SELECT value FROM kv WHERE key = 'geofence_enabled'").get()?.value === "1";
}

/** Mirrors unresolvedCentres(). */
function unresolved() {
  const have = new Set(db.prepare("SELECT key FROM location_coords").all().map((r) => r.key));
  return fencedKeys().filter((k) => !have.has(k));
}

/** Mirrors setGeofenceEnabled(), guard included. */
function setOn(on) {
  if (on && unresolved().length) return { error: "unresolved" };
  db.prepare(
    "INSERT INTO kv (key, value) VALUES ('geofence_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(on ? "1" : "0");
  return { ok: true };
}

function resolveAll() {
  const now = new Date().toISOString();
  for (const k of fencedKeys()) {
    db.prepare(
      `INSERT INTO location_coords (key, lat, lng, resolved_from, source, resolved_at)
       VALUES (?, 1.3, 103.8, '737715', 'onemap', ?)
       ON CONFLICT(key) DO UPDATE SET lat = excluded.lat, lng = excluded.lng`
    ).run(k, now);
  }
}

describe("the stored switch", () => {
  test("it is OFF when nothing has ever been stored", () => {
    // Not timidity: a fence that defaults on, on a deploy where geocoding has
    // not run, refuses every clock-in at every centre for all 67 teachers.
    assert.equal(isOn(), false);
  });

  test("turning it on is refused while any centre is unresolved", () => {
    assert.equal(setOn(true).error, "unresolved");
    assert.equal(isOn(), false, "and it must not have been half-written");
  });

  test("one unresolved centre out of six is still a refusal", () => {
    resolveAll();
    db.prepare("DELETE FROM location_coords WHERE key = ?").run(fencedKeys()[0]);
    assert.equal(setOn(true).error, "unresolved");
  });

  test("with every centre resolved it turns on", () => {
    resolveAll();
    assert.equal(unresolved().length, 0);
    assert.equal(setOn(true).ok, true);
    assert.equal(isOn(), true);
  });

  test("turning it OFF is never guarded, even with nothing resolved", () => {
    // The button you need when somebody is standing at the centre unable to
    // start their shift. Making it conditional would be the opposite of safe.
    assert.equal(setOn(false).ok, true);
    assert.equal(isOn(), false);
  });

  test("off then on then off leaves it off, with no stray rows", () => {
    resolveAll();
    setOn(true);
    setOn(false);
    assert.equal(isOn(), false);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM kv WHERE key='geofence_enabled'").get().c, 1);
  });
});

describe("the switch history", () => {
  const note = (on, actor = "karim", name = "Nur Abdul Karim") =>
    db
      .prepare("INSERT INTO geofence_log (id, enabled, actor_id, actor_name, at) VALUES (?,?,?,?,?)")
      .run(randomUUID(), on ? 1 : 0, actor, name, new Date().toISOString());

  beforeEach(() => {
    db.exec("DELETE FROM profiles");
    db.prepare(
      "INSERT INTO profiles (id, full_name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?)"
    ).run("karim", "Nur Abdul Karim", "karim@fence.local", "x", "admin", new Date().toISOString());
  });

  test("a switch records who threw it and which way", () => {
    note(true);
    const r = db.prepare("SELECT * FROM geofence_log").get();
    assert.equal(r.enabled, 1);
    assert.equal(r.actor_name, "Nur Abdul Karim");
  });

  test("the record outlives the admin who threw it", () => {
    // The point of denormalising the name. "Who turned this on" is asked the
    // morning it starts refusing somebody, which may be long after they left.
    note(true);
    db.prepare("DELETE FROM profiles WHERE id = 'karim'").run();
    const r = db.prepare("SELECT actor_id, actor_name FROM geofence_log").get();
    assert.equal(r.actor_id, null, "the fk is nulled, not the row deleted");
    assert.equal(r.actor_name, "Nur Abdul Karim");
  });

  test("several throws in one millisecond still read in order", () => {
    // rowid breaks the tie, as the read does. Without it an on/off/on pair
    // could display as off/on/on and misreport the current state's history.
    note(true);
    note(false);
    note(true);
    const rows = db
      .prepare("SELECT enabled FROM geofence_log ORDER BY at DESC, rowid DESC")
      .all()
      .map((r) => r.enabled);
    assert.deepEqual(rows, [1, 0, 1]);
  });
});

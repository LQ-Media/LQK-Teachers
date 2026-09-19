"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireFullAdmin } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { LOCATIONS, GEOFENCE_RADIUS_M } from "@/lib/hours/locations";
import {
  coordsFor,
  syncLocationCoords,
  unresolvedCentres,
  geofenceEnabled,
  setGeofenceEnabled,
} from "@/lib/hours/geocode";
import { summariseVerdicts, readinessOf } from "@/lib/hours/fence-report";

// Admin → Access → Clock-in location.
//
// This exists because the alternative was `node scripts/sync-location-coords.mjs`
// on the production box, and Karim does not have a terminal there. The script
// stays — it is the right tool for a deploy — but nothing about the fence should
// REQUIRE one, least of all turning it off in a hurry when it is wrongly
// refusing somebody at 7:25 in the morning.
//
// FULL ADMIN ONLY, every action. A centre IT Head can already adjust a
// clock-in; this switch decides whether clocking in is possible AT ALL, at
// every centre, for all 67 teachers. That is a different class of thing, and
// requireFullAdmin redirects rather than returning, which is the correct shape
// for a screen and means these can only be called from one.

/**
 * What the screen shows: the centres, their coordinates, the switch, and the
 * verdicts recorded so far.
 *
 * One read, because the three are one decision — coordinates without the
 * recorded distances is a green tick with nothing behind it.
 */
export async function geofenceStatus() {
  await requireFullAdmin();
  const db = getDb();

  const centres = LOCATIONS.filter((l) => l.fenced).map((l) => {
    const c = coordsFor(l.key);
    return {
      key: l.key,
      label: l.label,
      address: l.address,
      postalCode: l.postalCode,
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      resolvedAt: c?.resolvedAt ?? null,
      source: c?.source ?? null,
    };
  });

  // The two placeless locations are listed too, and listed as deliberately
  // unfenced. Leaving them out would make somebody ask where Online went and
  // whether its absence means it is being checked.
  const unfenced = LOCATIONS.filter((l) => !l.fenced).map((l) => ({
    key: l.key,
    label: l.label,
    note: l.note || null,
  }));

  // Recorded verdicts. 400 is well past a month of real taps and small enough
  // that the page stays a page.
  const rows = db
    .prepare(
      `SELECT w.geo_fence AS reason, w.geo_fence_m AS metres, w.geo_at AS at,
              w.created_at AS fallback_at, w.branch AS branch, p.full_name AS teacher
       FROM work_sessions w
       LEFT JOIN profiles p ON p.id = w.teacher_id
       WHERE w.geo_fence IS NOT NULL
       -- geo_at is null when the phone gave no fix, and those rows matter most
       -- of all here, so they must not sort into a corner.
       ORDER BY COALESCE(w.geo_at, w.created_at) DESC
       LIMIT 400`
    )
    .all()
    .map((r) => ({
      reason: r.reason,
      metres: Number.isFinite(r.metres) ? r.metres : null,
      at: r.at || r.fallback_at || null,
      branch: r.branch || null,
      teacher: r.teacher || "(deleted account)",
    }));

  const summary = summariseVerdicts(rows);
  const missing = unresolvedCentres();
  const missingLabels = centres.filter((c) => missing.includes(c.key)).map((c) => c.label);

  const log = db
    .prepare("SELECT id, enabled, actor_name, at FROM geofence_log ORDER BY at DESC, rowid DESC LIMIT 20")
    .all()
    .map((r) => ({ id: r.id, enabled: !!r.enabled, by: r.actor_name || "(unknown)", at: r.at }));

  return {
    enabled: geofenceEnabled(),
    radiusM: GEOFENCE_RADIUS_M,
    centres,
    unfenced,
    unresolved: missingLabels,
    summary,
    readiness: readinessOf(summary, missingLabels),
    log,
  };
}

/**
 * Resolve the centres' coordinates against OneMap.
 *
 * `force` re-resolves centres that already have a coordinate — for when LQK
 * moves a centre and the postal code in lib/hours/locations.js has changed.
 * Without it, only the missing ones are fetched, so the ordinary case is one
 * button somebody can press twice without consequence.
 *
 * Never partially fails silently: the per-centre report comes back whole, so
 * "three of four resolved" is visible rather than being flattened into a tick.
 */
export async function resolveLocationCoords(force = false) {
  await requireFullAdmin();

  let report;
  try {
    report = await syncLocationCoords({ force: !!force });
  } catch (err) {
    // OneMap being down is not an error the admin caused, and it must not
    // present as a broken screen.
    return {
      error: `Couldn’t reach OneMap just now (${err?.message || "network error"}). Nothing was changed — try again shortly.`,
    };
  }

  const resolved = report.filter((r) => r.status === "resolved");
  const failed = report.filter((r) => r.status === "failed");

  revalidatePath("/admin");
  return {
    ok: true,
    report,
    resolved: resolved.length,
    already: report.filter((r) => r.status === "already").length,
    failed: failed.length,
  };
}

/**
 * Throw the switch.
 *
 * ON is refused while any centre is unresolved — setGeofenceEnabled() enforces
 * it, and it is the one guard that matters: with the fence on and a centre
 * without coordinates, checkGeofence returns no_coords and every clock-in there
 * is refused. That is correct behaviour for the check and a catastrophe for a
 * Saturday morning, so it cannot be reachable by a misclick.
 *
 * OFF is never refused and never guarded. Turning a fence off is the thing you
 * need to be able to do instantly when it is wrong, and making that harder
 * would be the opposite of safe.
 */
export async function setFenceEnabled(on) {
  const session = await requireFullAdmin();
  const want = !!on;

  const r = setGeofenceEnabled(want);
  if (r?.error) return r;

  // Recorded, because "who turned the clock-in check on" is the first question
  // asked the morning it starts refusing somebody.
  try {
    getDb()
      .prepare("INSERT INTO geofence_log (id, enabled, actor_id, actor_name, at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), want ? 1 : 0, session.userId, session.fullName || null, new Date().toISOString());
  } catch (err) {
    // The switch is the deliverable; failing to write the note must not undo
    // it, least of all when somebody is turning the fence OFF to unblock a
    // teacher standing at the door.
    console.error("[geofence] could not record the switch:", err?.message || err);
  }

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true, enabled: want };
}

import "server-only";
import { getDb } from "@/lib/db";
import { LOCATIONS, LOCATION_BY_KEY } from "./locations.js";

// Resolving each centre's postal code to a coordinate, once, and remembering
// the answer.
//
// Same shape as the MOM public-holiday sync: an official source is consulted
// occasionally, the answer is written to the database, and everything that
// reads it afterwards reads the database. A geocoder being slow or down must
// never be in the path of a teacher tapping "clock in".
//
// OneMap is the Singapore Land Authority's own service and is authoritative
// for local postal codes in a way a global geocoder is not — 737715 resolves
// to the actual Woods Square tower rather than to the middle of Woodlands.

const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";

/** A centre's stored coordinate, or null if it has never resolved. */
export function coordsFor(key) {
  const row = getDb()
    .prepare("SELECT lat, lng, resolved_at, source FROM location_coords WHERE key = ?")
    .get(key);
  return row ? { lat: row.lat, lng: row.lng, resolvedAt: row.resolved_at, source: row.source } : null;
}

/** Every stored coordinate, keyed. */
export function allCoords() {
  const out = {};
  for (const r of getDb().prepare("SELECT key, lat, lng FROM location_coords").all()) {
    out[r.key] = { lat: r.lat, lng: r.lng };
  }
  return out;
}

/**
 * A location with its coordinate attached, ready for checkGeofence.
 *
 * A fenced centre with no stored coordinate comes back WITHOUT lat/lng, which
 * is what makes needsCoords() true and checkGeofence refuse. That is the
 * intended path — it must not be smoothed over here.
 */
export function hydrate(location) {
  if (!location || !location.fenced) return location;
  const c = coordsFor(location.key);
  return c ? { ...location, lat: c.lat, lng: c.lng } : location;
}

export function saveCoords(key, lat, lng, resolvedFrom, source = "onemap") {
  getDb()
    .prepare(
      `INSERT INTO location_coords (key, lat, lng, resolved_from, source, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         lat = excluded.lat, lng = excluded.lng, resolved_from = excluded.resolved_from,
         source = excluded.source, resolved_at = excluded.resolved_at`
    )
    .run(key, lat, lng, resolvedFrom, source, new Date().toISOString());
}

/**
 * Ask OneMap where a postal code is.
 *
 * Never throws — a caller that cannot resolve a centre must leave it
 * unresolved, not crash a sync or, worse, write a coordinate it is not sure
 * about. Returns `{ lat, lng, address }` on success, or `{ error }` saying
 * WHICH failure it was.
 *
 * The distinction earns its keep on the screen. "OneMap gave no match for that
 * postal code" sends an admin to check the address in locations.js; "couldn't
 * reach OneMap" sends them to try again in a minute. Collapsing both into null
 * — which this did at first — tells somebody their correct postal code is
 * wrong, and they go and change it.
 *
 * The postal-code match is checked against what came back. OneMap's search is
 * fuzzy, and a six-digit code that matches nothing can return a road with a
 * similar-looking number; writing that as a centre's location would put a fence
 * around the wrong building, which is precisely the failure that hand-typed
 * coordinates were avoided to prevent.
 */
export async function geocodePostalCode(postalCode) {
  const code = String(postalCode || "").trim();
  if (!/^\d{6}$/.test(code)) return { error: "not a six-digit postal code" };

  const url =
    `${ONEMAP_SEARCH}?searchVal=${encodeURIComponent(code)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
  } catch (err) {
    // Unreachable, refused, DNS, or the ten-second timeout. OUR end or the
    // network's — never the postal code's fault.
    return {
      error: err?.name === "TimeoutError" ? "OneMap timed out" : `couldn’t reach OneMap (${err?.message || "network error"})`,
      unreachable: true,
    };
  }

  try {
    if (!res.ok) return { error: `OneMap answered HTTP ${res.status}`, unreachable: true };
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];
    const hit = results.find((r) => String(r.POSTAL || "").trim() === code);
    if (!hit) return { error: `OneMap had no exact match for ${code}` };

    const lat = Number(hit.LATITUDE);
    const lng = Number(hit.LONGITUDE);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "OneMap returned no coordinates" };

    // Singapore, roughly. A coordinate outside this box is not a Singapore
    // postal code however confidently it was returned.
    if (lat < 1.15 || lat > 1.5 || lng < 103.55 || lng > 104.1) {
      return { error: `OneMap returned a point outside Singapore (${lat}, ${lng})` };
    }

    return { lat, lng, address: hit.ADDRESS || null, matched: hit.POSTAL };
  } catch (err) {
    return { error: `couldn’t read OneMap’s answer (${err?.message || "bad response"})`, unreachable: true };
  }
}

/**
 * Resolve every fenced centre that has no coordinate yet.
 *
 * Returns a per-centre report rather than a boolean, because "three of four
 * resolved" is the case that matters and a boolean would hide it.
 */
export async function syncLocationCoords({ force = false } = {}) {
  const report = [];
  for (const loc of LOCATIONS) {
    if (!loc.fenced) continue;
    const existing = coordsFor(loc.key);
    if (existing && !force) {
      report.push({ key: loc.key, label: loc.label, status: "already", ...existing });
      continue;
    }
    const hit = await geocodePostalCode(loc.postalCode);
    if (!hit || hit.error) {
      report.push({
        key: loc.key,
        label: loc.label,
        status: "failed",
        postalCode: loc.postalCode,
        // Carried through so the screen can tell an admin whether to check the
        // address or just try again.
        reason: hit?.error || "no result",
        unreachable: !!hit?.unreachable,
      });
      continue;
    }
    saveCoords(loc.key, hit.lat, hit.lng, loc.postalCode, "onemap");
    report.push({
      key: loc.key,
      label: loc.label,
      status: "resolved",
      lat: hit.lat,
      lng: hit.lng,
      address: hit.address || null,
    });
  }
  return report;
}

/** Fenced centres still without a coordinate. */
export function unresolvedCentres() {
  const have = allCoords();
  return LOCATIONS.filter((l) => l.fenced && !have[l.key]).map((l) => l.key);
}

// ---- The switch ---------------------------------------------------------
//
// THE FENCE IS OFF UNTIL SOMEBODY TURNS IT ON, and that is not timidity.
//
// A fence that refuses when it has no coordinates is the correct behaviour —
// see checkGeofence — but combined with "no clock-in means no pay" it means a
// deploy where geocoding has not run yet would refuse EVERY clock-in at EVERY
// centre, for all 67 teachers, on the first morning. The right of a check to
// fail closed does not extend to failing closed before anyone has checked that
// it works.
//
// So: OFF is an explicit, visible, stored state, not a silent fall-through.
// While off, every clock-in still computes and RECORDS its verdict, so the
// distances can be read back and sanity-checked against real taps before the
// switch is thrown. Turning it on is a deliberate act, and refuses while any
// centre is unresolved.

const FENCE_KEY = "geofence_enabled";

export function geofenceEnabled() {
  const row = getDb().prepare("SELECT value FROM kv WHERE key = ?").get(FENCE_KEY);
  return row?.value === "1";
}

export function setGeofenceEnabled(on) {
  if (on && unresolvedCentres().length) {
    return { error: "Some centres have no coordinates yet. Run the location sync first." };
  }
  getDb()
    .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(FENCE_KEY, on ? "1" : "0");
  return { ok: true, enabled: !!on };
}

export { LOCATION_BY_KEY };

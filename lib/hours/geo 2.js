// Geo-tagging for Ad-hoc / OT sessions.
//
// OT is worked wherever the job is — a centre being cleaned, an event venue,
// someone's home visit — so a session can carry ONE location stamp taken from
// the teacher's device when they tap "Tag my location".
//
// Deliberately NOT tracking: nothing is sampled while the timer runs, there is
// no background watch, and the tag is optional — OT still logs fine without it.
// One point, captured on a tap, so an admin can see where the work happened.
//
// The readable label is resolved ONCE, server-side, at capture time and stored
// on the row (see reverseGeocode). Reading payroll never calls out to a
// geocoder — which keeps the admin screen fast and stays inside Nominatim's
// usage policy.
//
// No DB or server-only imports here — like rates.js, this module is shared by
// server actions and client components. `reverseGeocode` uses plain fetch and
// is only ever called from the server.

/** A fix vaguer than this says nothing useful about a work location. */
export const MAX_ACCURACY_M = 5000;

/** Attribution for the reverse-geocoded labels — must stay wherever they show. */
export const GEO_ATTRIBUTION = "Places © OpenStreetMap contributors";

/**
 * Validate a device fix into the shape we store, or null if it's unusable.
 * Accepts strings (form/JSON round-trips) as well as numbers.
 */
export function parseFix(raw) {
  if (!raw) return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // 0,0 is in the Gulf of Guinea — in practice it means "no fix", not a location.
  if (lat === 0 && lng === 0) return null;
  const acc = Number(raw.accuracy);
  const accuracy = Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null;
  if (accuracy != null && accuracy > MAX_ACCURACY_M) return null;
  return { lat, lng, accuracy };
}

/** True if a shaped session carries a location stamp. */
export function hasGeo(s) {
  return !!s?.geo && Number.isFinite(s.geo.lat) && Number.isFinite(s.geo.lng);
}

/** "1.43597, 103.78601" — 5 dp is about a metre, which is all a phone gives. */
export function formatCoords(lat, lng) {
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

/** "±12 m" / "±1.2 km", or "" when the device didn't report accuracy. */
export function formatAccuracy(metres) {
  if (metres == null || !Number.isFinite(Number(metres))) return "";
  const m = Math.round(Number(metres));
  return m >= 1000 ? `±${(m / 1000).toFixed(1)} km` : `±${m} m`;
}

/** Map link for a fix — opens in whatever maps app the device prefers. */
export function mapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

/** One-line description of a stamp: the label if we resolved one, else coords. */
export function geoLabelOf(geo) {
  if (!geo) return "";
  return geo.label || formatCoords(geo.lat, geo.lng);
}

// ---- Reverse geocoding (server-side only) ------------------------------

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";

// Nominatim asks for a descriptive User-Agent and at most 1 request/second.
// Tagging is a rare, human-paced action, but a queue makes the limit a fact
// rather than a hope.
const USER_AGENT = "LQK-Teachers-Portal/1.0 (+https://teachers.littlequrankids.sg; karim@littlequrankids.sg)";
let gate = Promise.resolve();

function throttled(fn) {
  const run = gate.then(fn, fn);
  // Hold the next caller for a second, whatever this one did.
  gate = run.then(
    () => new Promise((r) => setTimeout(r, 1100)),
    () => new Promise((r) => setTimeout(r, 1100))
  );
  return run;
}

/**
 * Build a human label from Nominatim's address parts rather than its
 * `display_name`. At building-level zoom the top-level `name` is often the
 * nearest shopfront ("Charles & Keith") — useless for "where did you work?" —
 * while road + neighbourhood + postcode reads like a Singapore address.
 */
export function labelFromAddress(data) {
  const a = data?.address || {};
  const parts = [
    a.building || a.amenity || a.school || a.place_of_worship || null,
    a.road || a.pedestrian || a.footway || a.residential || null,
    a.neighbourhood || a.quarter || a.suburb || a.village || a.town || null,
    a.postcode || null,
  ];
  const seen = new Set();
  const label = parts
    .filter((p) => p && !seen.has(p) && seen.add(p))
    .join(", ")
    .trim();
  if (label) return label;
  // Fall back to the first few segments of the display name.
  const dn = String(data?.display_name || "").split(",").map((s) => s.trim()).filter(Boolean);
  return dn.slice(0, 3).join(", ");
}

// A teacher previews their fix and then saves it, so the same point is looked up
// twice within seconds. Keyed on ~11 m of precision, which is finer than any
// label we'd show and coarse enough that the second lookup always hits.
const cache = new Map();
const CACHE_MAX = 200;

function cacheKey(lat, lng) {
  return `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
}

/**
 * Resolve a fix to a place name. Returns null on any failure — a missing label
 * is cosmetic, the coordinates are the record, so a geocoder being slow or down
 * must never block a teacher from tagging.
 */
export async function reverseGeocode(lat, lng) {
  const key = cacheKey(lat, lng);
  if (cache.has(key)) return cache.get(key);

  const url = `${NOMINATIM}?format=jsonv2&zoom=18&addressdetails=1&lat=${Number(lat).toFixed(6)}&lon=${Number(lng).toFixed(6)}`;
  const label = await fetchLabel(url);
  if (label) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, label);
  }
  return label;
}

async function fetchLabel(url) {
  try {
    return await throttled(async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const label = labelFromAddress(await res.json());
      return label || null;
    });
  } catch {
    return null;
  }
}

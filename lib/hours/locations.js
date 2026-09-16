// Where a shift happens, and whether clocking in is fenced to that place.
//
// Two kinds of location, and the difference is the whole point of this file:
//
//   FENCED    — a centre. The teacher must be within GEOFENCE_RADIUS_M of it
//               to clock in, matching what Sling enforces today.
//   UNFENCED  — "Outside LQK" (external events) and "Online" (meetings). A
//               clock-in is STILL REQUIRED; it just cannot be checked against
//               a place, because there isn't one. Karim, 16 Sep 2026.
//
// Unfenced is not a weaker centre, it is a different thing, so it is a flag
// rather than a missing coordinate. A centre whose coordinates have not been
// resolved yet must NOT silently behave like "Online" and wave everyone
// through — see needsCoords().
//
// COORDINATES ARE RESOLVED AT RUNTIME, not stored here. The addresses below
// are what LQK gave us; the latitude and longitude come from geocoding the
// postal code against OneMap on the server, the same shape as the MOM holiday
// sync in holidays.js. Hand-typed coordinates in a source file are a bad idea
// for something that can block a teacher from clocking in — one transposed
// digit and somebody is standing outside a locked app.
//
// Pure — no DB, no server imports.

/**
 * How far from a centre a clock-in is still accepted.
 *
 * 1000 m, matching the Sling setting. It is deliberately loose, and it has to
 * be: every centre is on an upper floor of an office block, where a phone's
 * GPS is at its worst. This is an "are you at work" check, not an "are you in
 * the room" check.
 *
 * A consequence worth knowing: Woods Square and Primz Bizhub are both in
 * Woodlands and well within a kilometre of each other, so at this radius the
 * fence cannot tell them apart. That is acceptable — the roster already says
 * which centre the shift is at, and the fence is only asked whether the
 * teacher is plausibly there.
 */
export const GEOFENCE_RADIUS_M = 1000;

/**
 * The centres and the two placeless locations, keyed as Sling names them so an
 * import can match on the string it already uses.
 */
export const LOCATIONS = [
  {
    key: "wdsq_1",
    slingName: "LQK WDSQ 1 (78)",
    label: "Woods Square 1",
    address: "12 Woodlands Square, Tower 1, #03-78",
    postalCode: "737715",
    fenced: true,
  },
  {
    key: "wdsq_2",
    slingName: "LQK WDSQ 2 (79)",
    label: "Woods Square 2",
    address: "12 Woodlands Square, Tower 1, #03-79",
    postalCode: "737715",
    fenced: true,
  },
  {
    key: "wdsq_3",
    slingName: "LQK WDSQ 3 (77)",
    label: "Woods Square 3",
    address: "12 Woodlands Square, Tower 1, #03-77",
    postalCode: "737715",
    fenced: true,
  },
  {
    key: "primz",
    slingName: "LQK PRIMZ BIZHUB",
    label: "Primz Bizhub",
    address: "21 Woodlands Close, #09-32",
    postalCode: "737854",
    fenced: true,
  },
  {
    key: "tampines_462",
    slingName: "LQK TAMPINES 462",
    label: "Tampines 462",
    address: "462 Tampines Street 44, #02-76",
    postalCode: "520462",
    fenced: true,
  },
  {
    key: "tampines_junction",
    slingName: "LQK TAMPINES JUNCTION",
    label: "Tampines Junction",
    address: "300 Tampines Avenue 5, Income @ Tampines Junction, #05-06",
    postalCode: "529653",
    fenced: true,
  },
  {
    key: "outside",
    slingName: "Outside LQK",
    label: "Outside LQK",
    address: null,
    postalCode: null,
    fenced: false,
    note: "External events. Clock-in required, location not checked.",
  },
  {
    key: "online",
    slingName: "Online",
    label: "Online",
    address: null,
    postalCode: null,
    fenced: false,
    note: "Online meetings. Clock-in required, location not checked.",
  },
];

export const LOCATION_BY_KEY = Object.fromEntries(LOCATIONS.map((l) => [l.key, l]));

/** Match a Sling location string to a location, case- and space-insensitively. */
export function locationForSlingName(name) {
  const n = String(name || "").trim().toUpperCase();
  if (!n) return null;
  return LOCATIONS.find((l) => l.slingName.toUpperCase() === n) || null;
}

/** True when clocking in here must be checked against coordinates. */
export function isFenced(locationKey) {
  return !!LOCATION_BY_KEY[locationKey]?.fenced;
}

/**
 * A fenced centre whose coordinates have not been resolved yet.
 *
 * Callers must treat this as "cannot check right now" and decide deliberately,
 * never as "no fence". Letting an unresolved centre fall through to unfenced
 * would quietly disable the check for everyone the first time a geocode fails.
 */
export function needsCoords(location) {
  return !!location?.fenced && (location.lat == null || location.lng == null);
}

/**
 * Metres between two WGS84 points, by the haversine formula.
 *
 * Good to well under a metre at these distances, which is far finer than the
 * kilometre fence or than consumer GPS, so the approximation is not the weak
 * link here — the phone is.
 */
export function distanceMetres(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a clock-in at `point` is allowed for a shift at `location`.
 *
 * `{ ok, reason, metres }`. The three refusals are kept apart on purpose,
 * because they need different words in front of a teacher who is standing in
 * their classroom unable to start their shift:
 *
 *   too_far      — we know where they are, and it is not here
 *   no_fix       — their phone could not get a location
 *   no_coords    — WE have not resolved the centre yet; their problem to
 *                  suffer, ours to fix, and it must reach an admin
 */
export function checkGeofence(location, point, radius = GEOFENCE_RADIUS_M) {
  if (!location || !location.fenced) return { ok: true, reason: "unfenced", metres: null };
  if (needsCoords(location)) return { ok: false, reason: "no_coords", metres: null };
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { ok: false, reason: "no_fix", metres: null };
  }
  const metres = distanceMetres(location, point);
  return metres <= radius
    ? { ok: true, reason: "inside", metres }
    : { ok: false, reason: "too_far", metres };
}

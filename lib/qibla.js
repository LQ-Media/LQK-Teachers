// Qibla direction maths — pure functions, no DOM, so they can be unit-tested.
//
// The Qibla is the initial great-circle bearing from the observer to the Kaaba
// (the shortest path over the sphere), which is the standard definition used by
// prayer-direction tools. It is NOT the same as a straight line on a flat map.

/** The Kaaba, Masjid al-Haram, Makkah. */
export const KAABA = { lat: 21.4224779, lng: 39.4831694 };

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Normalise any angle into [0, 360). */
export function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Initial great-circle bearing from (lat,lng) to the Kaaba, in degrees
 * clockwise from true north. e.g. Singapore ≈ 293°, London ≈ 119°.
 */
export function qiblaBearing(lat, lng) {
  const phi1 = toRad(lat);
  const phi2 = toRad(KAABA.lat);
  const dLambda = toRad(KAABA.lng - lng);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Great-circle distance to the Kaaba in kilometres. */
export function distanceToKaabaKm(lat, lng) {
  const R = 6371; // mean Earth radius, km
  const phi1 = toRad(lat);
  const phi2 = toRad(KAABA.lat);
  const dPhi = toRad(KAABA.lat - lat);
  const dLambda = toRad(KAABA.lng - lng);

  const a =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Smallest signed turn (−180…180] from `from` to `to`, in degrees.
 * Positive = turn right/clockwise, negative = turn left.
 */
export function signedDelta(from, to) {
  let d = normalizeDeg(to - from);
  if (d > 180) d -= 360;
  return d;
}

/** 16-point compass label for a bearing, e.g. 293° → "WNW". */
export function compassPoint(deg) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(normalizeDeg(deg) / 22.5) % 16];
}

/**
 * Read a compass heading (degrees clockwise from north) out of a
 * deviceorientation event, or null if this event can't give an absolute one.
 *  • iOS Safari exposes webkitCompassHeading (already clockwise from north).
 *  • Android/Chrome gives alpha counter-clockwise from north on absolute events.
 */
export function headingFromOrientation(event) {
  if (!event) return null;
  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return normalizeDeg(event.webkitCompassHeading);
  }
  if (event.absolute === true && typeof event.alpha === "number" && !Number.isNaN(event.alpha)) {
    return normalizeDeg(360 - event.alpha);
  }
  return null;
}

/**
 * The tracing maths, kept away from the DOM so it can be tested.
 *
 * The component samples each SVG stroke into a polyline with
 * `SVGPathElement.getPointAtLength` and hands the points here; everything about
 * "is the finger on the letter, and how far along is it" lives in this file and
 * in test/games-trace.test.mjs. This split matters because the feel of the game
 * is entirely in these numbers, and getting them wrong is the difference between
 * a child succeeding and a child giving up.
 *
 * HOW PROGRESS WORKS
 *
 * Progress is a distance along the stroke, never a point. Each pointer sample
 * is projected onto the polyline, but only onto the window that starts at the
 * progress already earned and runs `lookAhead` further on. That window is what
 * makes the trace honest:
 *
 *   - You cannot skip. Touching near the end of the letter while at 10% finds
 *     nothing inside the window, so nothing happens.
 *   - You cannot scribble. Progress is a maximum, so sawing back and forth adds
 *     nothing after the first pass.
 *   - You cannot cut a corner. Leaving the band stops the glow where it was,
 *     and the child feels the letter resist rather than being told off.
 *
 * Both difficulty levels use the same projection; they differ only in how wide
 * the band is, how far ahead you may reach, and whether the stroke has to be
 * started at its proper beginning.
 */

/**
 * Coordinates are in the geometry's 1000-unit viewBox, so tolerances are too —
 * and that is exactly the trap, because a viewBox unit is not a fixed size.
 *
 * WHY EACH LEVEL CARRIES A SECOND, PHYSICAL SET OF NUMBERS
 *
 * The letter is drawn to fill whatever space it is given, so one viewBox unit
 * is about 0.37 CSS pixels on a 390px phone and about 0.88 on a 1920px
 * screen. The child's finger does not resize to match. Measured against the
 * unit-only tolerances below, that meant:
 *
 *                     road width   easy band   proper band   dot target
 *   phone 390px            22px        39px         23px      25px across
 *   10-inch tablet         41px        73px         43px      48px
 *   TV 1920px              51px        92px         54px      60px
 *
 * A child's fingertip is 40-45 CSS px across. So on a phone the road was half
 * a fingertip wide and the Proper band was narrower than the finger tracing
 * it: every natural wobble left the band, the glow stopped, and the trace felt
 * stop-start — while the same code on a big screen felt fine, because there
 * the band was two fingers wide.
 *
 * So each level also states its band in CSS PIXELS, and scaleFor() takes
 * whichever is larger at the size actually being rendered. Taking the larger
 * rather than replacing means a big screen keeps exactly the feel it has now
 * and only small screens loosen — the fix cannot make any device stricter than
 * it was.
 */
export const LEVELS = {
  // Four-year-olds, a finger, and a tablet held at an angle. Wide band, long
  // reach, start anywhere near the path: the goal is the shape, not the motion.
  easy: {
    tolerance: 105,
    lookAhead: 260,
    requireStart: false,
    completeAt: 0.88,
    tolerancePx: 73,
    lookAheadPx: 182,
  },
  // The writing motion: start on the dot, follow the direction, no shortcuts.
  proper: {
    tolerance: 62,
    lookAhead: 130,
    requireStart: true,
    completeAt: 0.94,
    tolerancePx: 43,
    lookAheadPx: 91,
  },
};

export function levelFor(name) {
  return LEVELS[name] ?? LEVELS.easy;
}

/**
 * The level's numbers at the size the letter is actually drawn.
 *
 * `unitsPerPx` is how many viewBox units one CSS pixel covers — bigger on a
 * small screen. The physical floors are stated for a 10-inch tablet, which is
 * the device this deck is taught on, so that is the size at which nothing
 * changes at all.
 */
export function scaleFor(level, unitsPerPx = 1) {
  const u = Number.isFinite(unitsPerPx) && unitsPerPx > 0 ? unitsPerPx : 1;
  return {
    ...level,
    tolerance: Math.max(level.tolerance, (level.tolerancePx ?? 0) * u),
    lookAhead: Math.max(level.lookAhead, (level.lookAheadPx ?? 0) * u),
  };
}

/** Cumulative distance to each point; last entry is the polyline's length. */
export function cumulative(points) {
  const cums = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    cums.push(cums[i - 1] + Math.hypot(dx, dy));
  }
  return cums;
}

/** Squared distance from p to segment ab, plus where on ab the foot landed. */
function projectOnSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1,
    ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2));
  const fx = a[0] + t * abx;
  const fy = a[1] + t * aby;
  return { t, dist: Math.hypot(p[0] - fx, p[1] - fy) };
}

/**
 * Nearest point on the polyline to `p`, searched only between the distances
 * `from` and `to` along it. Returns null when that stretch holds nothing.
 */
export function nearestWithin(points, cums, p, from, to) {
  let best = null;
  for (let i = 1; i < points.length; i++) {
    // Skip segments wholly outside the window, but keep any that straddle it —
    // the foot of the projection can land inside even when an endpoint doesn't.
    if (cums[i] < from || cums[i - 1] > to) continue;
    const { t, dist } = projectOnSegment(p, points[i - 1], points[i]);
    const at = cums[i - 1] + t * (cums[i] - cums[i - 1]);
    if (at < from || at > to) continue;
    if (!best || dist < best.dist) best = { dist, at };
  }
  return best;
}

/**
 * One pointer sample against one stroke.
 *
 * Returns the new progress and why: `advanced` when the glow grew, `held` when
 * the finger is on the path but not further along, `off` when it strayed out of
 * the band, and `wrongStart` when a proper-level trace was begun mid-letter.
 */
export function advance({ points, cums, pointer, progress, level, started }) {
  const { tolerance, lookAhead, requireStart } = level;
  const total = cums[cums.length - 1];

  if (!started && requireStart) {
    // The first touch has to land on the beginning of the stroke, or the child
    // is being taught to write the letter backwards.
    const d = Math.hypot(pointer[0] - points[0][0], pointer[1] - points[0][1]);
    if (d > tolerance) return { progress, state: "wrongStart" };
  }

  // Easy mode lets the finger pick the path up slightly behind where it left
  // off, which forgives the wobble of a small hand without allowing a skip.
  const from = requireStart ? progress : Math.max(0, progress - tolerance);
  const hit = nearestWithin(points, cums, pointer, from, Math.min(total, progress + lookAhead));

  if (!hit || hit.dist > tolerance) return { progress, state: "off" };
  if (hit.at <= progress) return { progress, state: "held" };
  return { progress: hit.at, state: "advanced" };
}

/** 0..1 for the glow's dash reveal and the progress ring. */
export function fraction(progress, total) {
  return total > 0 ? Math.min(1, progress / total) : 0;
}

export function isComplete(progress, total, level) {
  return fraction(progress, total) >= level.completeAt;
}

/**
 * Where to put the "go this way" arrow: a little ahead of the finger, angled
 * along the path. Returned in viewBox coordinates with a degrees rotation.
 */
export function hintAt(points, cums, progress, ahead = 70) {
  const total = cums[cums.length - 1];
  const target = Math.min(total, progress + ahead);
  for (let i = 1; i < points.length; i++) {
    if (cums[i] < target) continue;
    const span = cums[i] - cums[i - 1];
    const t = span === 0 ? 0 : (target - cums[i - 1]) / span;
    const x = points[i - 1][0] + t * (points[i][0] - points[i - 1][0]);
    const y = points[i - 1][1] + t * (points[i][1] - points[i - 1][1]);
    const angle = Math.atan2(points[i][1] - points[i - 1][1],
      points[i][0] - points[i - 1][0]) * 180 / Math.PI;
    return { x, y, angle };
  }
  const last = points[points.length - 1];
  return { x: last[0], y: last[1], angle: 0 };
}

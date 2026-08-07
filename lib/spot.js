/**
 * Page spot art — one soft 3D clay render per portal destination.
 *
 * Same visual language as the devotional group tiles in lib/dzikir/icons.js:
 * Gemini-generated, 512² , and rendered on a full-bleed pastel ground
 * (lavender / rose / peach) that matches the page's tone in PageHeading, so
 * the image *is* the tile — no pastel square underneath it.
 *
 * Keyed by the first path segment of the route. The line icon stays the
 * fallback and the small-size variant: below roughly 28px a clay render turns
 * to mush, so the sidebar rail and the bottom tab row keep their line icons
 * and only the 44px+ surfaces (page headings, the "More" sheet) use these.
 */
const SPOTS = new Set([
  "achievements",
  "admin",
  "dashboard",
  "dzikir",
  "hafalan",
  "hours",
  "ilmu",
  "kalimah",
  "notebook",
  "packs",
  "profile",
  "qibla",
  "quran",
  "reading",
  "review",
  "solat",
]);

export function spotImage(route) {
  if (!route) return null;
  const slug = route.replace(/^\/+/, "").split("/")[0];
  return SPOTS.has(slug) ? `/spot/${slug}.png` : null;
}

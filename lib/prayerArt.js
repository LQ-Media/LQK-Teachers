/**
 * The clay render for a prayer time — the sky at that hour, in real sky
 * colours (see the `prayer` group in scripts/art/manifest.mjs).
 *
 * Keyed by the Aladhan API's own prayer names, which is what both prayer
 * surfaces already carry: the dashboard SolatWidget and the /solat timetable.
 * Cut out on transparency, so the tinted circle behind it supplies the tone
 * and the art itself never changes colour with the theme.
 */
export function prayerArt(key) {
  return `/prayer/${String(key || "").toLowerCase()}.png`;
}

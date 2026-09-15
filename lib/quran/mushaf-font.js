/**
 * The mushaf's own per-page fonts (KFGQPC / QCF v2).
 *
 * A printed mushaf reaches both margins by stretching the LETTERS — kashida —
 * and CSS cannot do that at all. What it can do is draw the printed page's own
 * glyphs: in the QCF fonts every one of the 604 pages has a font file holding
 * exactly that page's words, each already shaped and stretched as it appears in
 * print. Set a line in its page's font and it comes out as the page does,
 * flush margins and all, with the line breaks of the mushaf rather than the
 * browser's.
 *
 * The cost is that the glyphs are private-use codepoints: in any other font
 * they are blank boxes. So loading is treated as something that CAN fail and
 * is reported honestly — a page whose font did not arrive renders as ordinary
 * Uthmani text instead, which is plain and correct, rather than as a page of
 * tofu. Nothing here ever renders a glyph it has not proved a font for.
 */

// Overridable so a host can serve the fonts themselves — from their own CDN, or
// from /public — without a code change. Must be NEXT_PUBLIC_*: this runs in the
// browser.
const DEFAULT_BASE = "https://static.qurancdn.com/fonts/quran/hafs/v2/woff2";

export function fontBase() {
  const configured = process.env.NEXT_PUBLIC_QCF_FONT_BASE;
  return String(configured || DEFAULT_BASE).replace(/\/+$/, "");
}

/** A CSS family name of our own — the file's internal name is not relied on. */
export function fontFamilyFor(page) {
  return `qcf-p${Number(page)}`;
}

export function fontUrlFor(page, base = fontBase()) {
  return `${String(base).replace(/\/+$/, "")}/p${Number(page)}.woff2`;
}

// One attempt per page for the life of the tab, shared by every caller, so
// paging back and forth does not re-request a font already loaded or re-try one
// already known to be missing.
const attempts = new Map();

export function canLoadFonts() {
  return typeof window !== "undefined" && typeof window.FontFace === "function" && !!document?.fonts;
}

/**
 * Make a page's font available. Resolves true when the page may be drawn with
 * it, false when the caller must fall back. Never rejects — a missing font is
 * an ordinary outcome here, not an error to handle at every call site.
 */
export function loadMushafFont(page) {
  const n = Number(page);
  if (!Number.isFinite(n) || n < 1) return Promise.resolve(false);
  if (!canLoadFonts()) return Promise.resolve(false);
  if (attempts.has(n)) return attempts.get(n);

  const family = fontFamilyFor(n);
  const attempt = (async () => {
    try {
      const face = new FontFace(family, `url("${fontUrlFor(n)}") format("woff2")`, {
        display: "block", // never paint the glyphs in a fallback face
      });
      await face.load();
      document.fonts.add(face);
      // Adding a face is not the same as the engine being ready to measure
      // with it. Without this the page is laid out once against the fallback's
      // metrics — wider glyphs, so the fit comes out too small — and the size
      // a teacher sees depends on how fast the font arrived.
      await document.fonts.load(`16px "${family}"`).catch(() => {});
      return true;
    } catch {
      return false; // offline, blocked, wrong URL, not a font — all the same here
    }
  })();

  attempts.set(n, attempt);
  return attempt;
}

/** Test seam: forget what has been tried. */
export function resetMushafFonts() {
  attempts.clear();
}

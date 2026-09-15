/**
 * Mushaf page layout — framework-agnostic, no Next/React code.
 *
 * The reader's original view is one card per ayah, which is what you want for
 * study: transliteration under the Arabic, a translation under that, controls
 * on every verse. It is not what you want for tilawah. A teacher reciting
 * their daily portion reads a PAGE — "sampai muka surat 25" — and page mode
 * exists so the app can be read the way the mushaf on the shelf is read.
 *
 * Page boundaries come from the API's own `page_number`, never from a table
 * written here. A page number is a fact about a specific printed mushaf (the
 * 604-page Madani), and a hand-copied list of "which surah starts on which
 * page" would be a silent, hard-to-notice error in a religious text the moment
 * one entry was mistyped. Everything below works only from verses the API
 * already handed us.
 */

/** The Madani mushaf the Quran.com page numbers refer to. */
export const PAGE_COUNT = 604;

export function clampPage(n) {
  const page = Math.round(Number(n));
  if (!Number.isFinite(page)) return 1;
  return Math.min(PAGE_COUNT, Math.max(1, page));
}

/** Surah number out of a "2:255"-style verse key. */
export function chapterOfVerse(verseKey) {
  return Number(String(verseKey).split(":")[0]) || 0;
}

/** Ayah number out of a "2:255"-style verse key. */
export function ayahOfVerse(verseKey) {
  return Number(String(verseKey).split(":")[1]) || 0;
}

/**
 * Split a page's verses into what actually gets drawn.
 *
 * A mushaf page is not one surah. Roughly a fifth of them carry the end of one
 * and the start of the next, and the short surahs at the back put four or five
 * on a single page — so the page is a sequence of runs, with a heading wherever
 * a surah BEGINS on this page. A run that merely continues a surah from the
 * previous page gets no heading, exactly as in print.
 *
 * Returns [{ type: "heading", chapterId, bismillah } | { type: "verses", chapterId, verses }].
 */
export function buildPageBlocks(verses) {
  const blocks = [];
  let run = null;

  for (const verse of verses || []) {
    const chapterId = Number(verse.chapterId) || chapterOfVerse(verse.verseKey);

    if (!run || run.chapterId !== chapterId) {
      if (Number(verse.number) === 1) {
        blocks.push({
          type: "heading",
          chapterId,
          // Al-Fatihah's basmalah IS its first ayah, so printing one above the
          // surah would show it twice; At-Tawbah has none at all.
          bismillah: chapterId !== 1 && chapterId !== 9,
        });
      }
      run = { type: "verses", chapterId, verses: [] };
      blocks.push(run);
    }

    run.verses.push(verse);
  }

  return blocks;
}

/** Surah numbers appearing on a page, in reading order. For the page header. */
export function chaptersOnPage(verses) {
  const seen = [];
  for (const verse of verses || []) {
    const chapterId = Number(verse.chapterId) || chapterOfVerse(verse.verseKey);
    if (chapterId && seen[seen.length - 1] !== chapterId) seen.push(chapterId);
  }
  return seen;
}

/**
 * The juz a page belongs to. A page can straddle a juz boundary; the one the
 * page OPENS in is what the printed header shows, so that is what we show.
 */
export function juzOfPage(verses) {
  for (const verse of verses || []) {
    const juz = Number(verse.juz);
    if (Number.isFinite(juz) && juz > 0) return juz;
  }
  return null;
}

/**
 * Which page an ayah sits on, from verses the API already gave us.
 *
 * Returns null when the answer isn't known locally — an older offline copy was
 * saved before page numbers were requested, so its verses have no `page`. The
 * caller then asks the API rather than guessing.
 */
export function pageOfVerse(verses, verseKey) {
  const match = (verses || []).find((v) => v.verseKey === verseKey);
  const page = Number(match?.page);
  return Number.isFinite(page) && page > 0 ? page : null;
}

/** The first ayah printed on a page — where a bookmark or a recitation starts. */
export function firstVerseOfPage(verses) {
  return (verses || [])[0]?.verseKey ?? null;
}

/**
 * Regroup a run of verses into the mushaf's own lines.
 *
 * In print a line is not a verse and a verse is not a line: one line carries
 * the end of one ayah and the start of the next, and a long ayah runs over
 * several. The API tags every word with the line it is printed on, so the page
 * is rebuilt line by line from those tags rather than from verse boundaries.
 *
 * Each returned item keeps the verse it came from, so tapping a word still
 * knows which ayah it belongs to.
 */
export function groupGlyphLines(verses) {
  const byLine = new Map();

  for (const verse of verses || []) {
    for (const glyph of verse.glyphs || []) {
      const line = Number(glyph.line);
      if (!Number.isFinite(line) || line < 1) continue;
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push({ ...glyph, verse });
    }
  }

  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, items]) => ({ line, items }));
}

/**
 * Can this run be drawn as the printed page?
 *
 * Every verse must carry glyphs AND a line number — a page half in mushaf
 * glyphs and half in ordinary text would be worse than either, so the whole
 * run falls back together.
 */
export function hasMushafGlyphs(verses) {
  const list = verses || [];
  if (!list.length) return false;
  return list.every(
    (verse) =>
      Array.isArray(verse.glyphs) &&
      verse.glyphs.length > 0 &&
      verse.glyphs.every((g) => g.code && Number(g.line) >= 1)
  );
}

/** The page font to draw a run with — the API's answer, or the page itself. */
export function fontPageOf(verses, fallbackPage) {
  for (const verse of verses || []) {
    const page = Number(verse.fontPage);
    if (Number.isFinite(page) && page > 0) return page;
  }
  return Number(fallbackPage) || null;
}

/** Western digits to Arabic-Indic, for ayah markers and the page number. */
export function arabicDigits(value) {
  return String(value).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
}

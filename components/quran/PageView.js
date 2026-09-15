"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import ArabicBody from "./ArabicBody";
import {
  arabicDigits,
  buildPageBlocks,
  chaptersOnPage,
  fontPageOf,
  groupGlyphLines,
  hasMushafGlyphs,
  juzOfPage,
} from "@/lib/quran/pages";
import { fontFamilyFor, loadMushafFont } from "@/lib/quran/mushaf-font";

/**
 * One printed page of the mushaf.
 *
 * Deliberately NOT a list of ayah cards with the gaps closed up. A page is
 * read as one continuous body of text — that is the whole reason a teacher
 * asks for page mode — so the verses of a surah run together, justified, with
 * only the ayah medallion between them, and a surah that begins mid-page gets
 * the ornamental band and basmalah it has in print.
 *
 * There are two ways it can be drawn, and which one you get depends on what
 * arrived:
 *
 *   FACSIMILE — the page's own font loaded and the API gave a glyph and line
 *     number for every word. The page is then rebuilt line by line out of the
 *     printed page's own glyphs: the mushaf's line breaks, its letterforms,
 *     and its flush margins, because each glyph already carries the kashida
 *     stretching print uses.
 *
 *   PLAIN — anything missing, so ordinary Uthmani text reflowed by the browser.
 *     The line breaks are then the browser's and the left edge is ragged, which
 *     is honest; what it is NOT is text-align: justify, because CSS justifies
 *     by stretching the SPACES and an Arabic line pulled apart that way looks
 *     nothing like print.
 *
 * Both draw the same page: the PAGE breaks are the mushaf's real ones either
 * way, and that is the boundary that matters for "read up to page 25".
 */
export default function PageView({
  verses,
  chapters,
  pageNumber,
  displayMode,
  settings,
  playingVerseKey,
  wordIndex,
  bookmarkVerseKey,
  onWordTap,
  onAyahTap,
  verseRef,
  mushafFont = true,
}) {
  const blocks = buildPageBlocks(verses);
  const juz = juzOfPage(verses);
  const names = chaptersOnPage(verses)
    .map((id) => chapters.find((c) => c.id === id))
    .filter(Boolean);

  // Draw as print only once the page's own font is in the document. Rendering
  // the glyphs a moment early would show a page of empty boxes, so the font is
  // proved first and never assumed.
  const glyphsReady = mushafFont && hasMushafGlyphs(verses);
  const fontPage = fontPageOf(verses, pageNumber);
  const [fontLoaded, setFontLoaded] = useState(false);

  useEffect(() => {
    if (!glyphsReady || !fontPage) return undefined;
    let live = true;
    loadMushafFont(fontPage).then((ok) => {
      if (live) setFontLoaded(ok);
    });
    return () => {
      live = false;
    };
  }, [glyphsReady, fontPage]);

  const asPrinted = glyphsReady && fontLoaded;

  return (
    <article className="rounded-card border-[0.5px] border-line bg-white px-4 py-5 shadow-[0_1px_3px_rgba(59,55,43,0.04)] sm:px-7 sm:py-7">
      {/* Running head — the surah on the page and the juz, as the mushaf prints it */}
      <header className="mb-5 flex items-baseline justify-between gap-3 border-b-[0.5px] border-line pb-2.5">
        <span className="text-[11.5px] font-bold uppercase tracking-wide text-charcoal-soft">
          {juz ? `Juz ${juz}` : " "}
        </span>
        <span className="font-arabic truncate text-[17px] text-charcoal" lang="ar" dir="rtl">
          {names.map((c) => c.nameArabic).join(" · ")}
        </span>
      </header>

      <div dir="rtl" lang="ar">
        {blocks.map((block, i) =>
          block.type === "heading" ? (
            <SurahBand
              key={`h${block.chapterId}`}
              chapter={chapters.find((c) => c.id === block.chapterId)}
              chapterId={block.chapterId}
              bismillah={block.bismillah}
              first={i === 0}
            />
          ) : asPrinted ? (
            <PrintedLines
              key={`m${block.chapterId}-${block.verses[0].verseKey}`}
              block={block}
              fontPage={fontPage}
              settings={settings}
              playingVerseKey={playingVerseKey}
              bookmarkVerseKey={bookmarkVerseKey}
              onWordTap={onWordTap}
              onAyahTap={onAyahTap}
              verseRef={verseRef}
            />
          ) : (
            <p
              key={`v${block.chapterId}-${block.verses[0].verseKey}`}
              // NOT text-align: justify. CSS justifies by stretching the
              // SPACES between words, which pulls an Arabic line apart into
              // scattered words — the mushaf reaches both margins by stretching
              // the letters themselves (kashida), which CSS cannot do. Natural
              // spacing with a ragged edge reads far closer to print than
              // evenly-spaced gaps do.
              className="font-arabic"
              style={{
                fontSize: `${settings.arabicSize}px`,
                lineHeight: 2.15,
                color: settings.arabicColor,
              }}
            >
              {block.verses.map((verse) => (
                <span
                  key={verse.verseKey}
                  ref={verseRef}
                  data-verse-key={verse.verseKey}
                  className={`rounded transition-colors ${
                    verse.verseKey === playingVerseKey ? "bg-gold-soft/45" : ""
                  }`}
                >
                  <ArabicBody
                    verse={verse}
                    displayMode={displayMode}
                    wordIndex={verse.verseKey === playingVerseKey ? wordIndex : null}
                    onWordTap={onWordTap}
                  />{" "}
                  <AyahMarker
                    number={verse.number}
                    bookmarked={verse.verseKey === bookmarkVerseKey}
                    onClick={() => onAyahTap(verse)}
                  />{" "}
                </span>
              ))}
            </p>
          )
        )}
      </div>

      {/* Page number, in the ornamental frame the mushaf gives it */}
      <footer className="mt-6 flex items-center gap-3 border-t-[0.5px] border-line pt-3.5">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        <span
          className="font-arabic rounded-pill border-[0.5px] border-gold/50 bg-gold-soft/30 px-3.5 py-0.5 text-[14px] text-[#96681A]"
          aria-label={`Page ${pageNumber}`}
        >
          {arabicDigits(pageNumber)}
        </span>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </footer>
    </article>
  );
}

/**
 * A run of verses drawn as the mushaf prints them: line by line, in the page's
 * own font, each glyph the shape it has on paper.
 *
 * The text size is the page's to decide, not the slider's: a printed page
 * fills its column, so the size is whatever makes it do that. The Arabic size
 * setting still governs the ayah layout and the plain fallback.
 *
 * The lines are NOT stretched to the margins. That was the first instinct and
 * it is the same mistake as text-align: justify — any line whose glyphs do not
 * happen to fill the column gets its words flung apart, which is the one thing
 * a mushaf page never looks like. Instead the font SIZE is fitted to the
 * column: every line of a QCF page is drawn to the same width, so sizing the
 * widest line to the column makes them all meet both margins at their natural
 * spacing, exactly as the page was set. A short last line then stays short and
 * centred, which is also what print does.
 */
// Measured at this size, then scaled to the column. Only a starting point —
// nothing is ever drawn at it.
const REFERENCE_PX = 40;

function PrintedLines({
  block,
  fontPage,
  settings,
  playingVerseKey,
  bookmarkVerseKey,
  onWordTap,
  onAyahTap,
  verseRef,
}) {
  const lines = groupGlyphLines(block.verses);
  const family = fontFamilyFor(fontPage);
  const wrapRef = useRef(null);
  const seen = new Set();

  // Fit the column. Glyph width scales linearly with font size, so one
  // measurement at the teacher's own size gives the factor outright.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;

    const fit = () => {
      el.style.fontSize = `${REFERENCE_PX}px`;
      const column = el.clientWidth;
      // Measure the inline run inside each line, not the line box: a block
      // element never reports a width below its own, so measuring the box
      // could only ever shrink an over-wide line and never grow a short one
      // to meet the column — which is the whole job here.
      let widest = 0;
      for (const run of el.querySelectorAll("[data-line-run]")) {
        widest = Math.max(widest, run.getBoundingClientRect().width);
      }
      if (!column || !widest) return;
      // Bounded in absolute pixels, not as a ratio: the only thing that should
      // ever produce an absurd size here is a font that half-loaded, and a
      // hard floor and ceiling catch that without capping a legitimate fit.
      const size = Math.min(120, Math.max(12, REFERENCE_PX * (column / widest)));
      el.style.fontSize = `${size}px`;
    };

    fit();
    // Web font metrics settle a beat after the face is added.
    document.fonts?.ready.then(fit).catch(() => {});
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [lines, family]);

  return (
    <div
      ref={wrapRef}
      className="mushaf-lines"
      style={{
        fontFamily: `${family}, var(--font-arabic, serif)`,
        color: settings.arabicColor,
        fontSize: `${REFERENCE_PX}px`, // replaced by the fit below, on the first layout
      }}
    >
      {lines.map((line) => (
        <div key={line.line} className="whitespace-nowrap text-center" style={{ lineHeight: 1.95 }}>
          <span data-line-run="" className="inline-block">
          {line.items.map((item, i) => {
            const verse = item.verse;
            // The scroll target for a verse is its first glyph on the page.
            const first = !seen.has(verse.verseKey) && (seen.add(verse.verseKey), true);
            const anchor = first ? { ref: verseRef, "data-verse-key": verse.verseKey } : {};

            if (item.type === "end") {
              return (
                <button
                  key={`${verse.verseKey}-end-${i}`}
                  type="button"
                  onClick={() => onAyahTap(verse)}
                  aria-label={`Ayah ${verse.number} — meaning, recitation and bookmark`}
                  className={`rounded align-baseline transition-colors hover:bg-gold-soft ${
                    verse.verseKey === bookmarkVerseKey ? "bg-gold-soft" : ""
                  }`}
                  {...anchor}
                >
                  {item.code}
                </button>
              );
            }

            return (
              <span
                key={`${verse.verseKey}-${i}`}
                role="button"
                tabIndex={0}
                onClick={() => onWordTap(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onWordTap(item);
                  }
                }}
                className={`cursor-pointer rounded transition-colors hover:bg-gold-soft/50 focus:bg-gold-soft/50 focus:outline-none ${
                  verse.verseKey === playingVerseKey ? "bg-gold-soft/45" : ""
                }`}
                {...anchor}
              >
                {item.code}
              </span>
            );
          })}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The band a surah opens with. In print this is a framed cartouche carrying the
 * surah's name; here it is the same idea in the portal's own materials, with
 * the basmalah beneath it for every surah that has one.
 */
function SurahBand({ chapter, chapterId, bismillah, first }) {
  return (
    <div className={`text-center ${first ? "mb-4" : "mb-4 mt-6"}`}>
      <div className="flex items-center justify-center gap-2.5 rounded-control border-[0.5px] border-gold/45 bg-gold-soft/25 px-4 py-2">
        <span className="text-gold/70" aria-hidden="true">
          <Icon name="feather" size={14} />
        </span>
        <span className="font-arabic text-[20px] text-charcoal" lang="ar">
          {chapter ? `سورة ${chapter.nameArabic}` : `سورة ${chapterId}`}
        </span>
        <span className="text-gold/70" aria-hidden="true">
          <Icon name="feather" size={14} />
        </span>
      </div>
      {bismillah && (
        <div className="font-arabic mt-3 text-[24px] text-charcoal" lang="ar">
          {/* U+FDFD — the basmalah as one ligature, the way the mushaf sets it */}
          ﷽
        </div>
      )}
    </div>
  );
}

/**
 * The ayah-end marker. It is also the only control on the page: tapping it
 * opens that ayah's meaning and recitation, which keeps the page itself free
 * of the buttons the ayah-by-ayah layout carries.
 */
function AyahMarker({ number, bookmarked, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Ayah ${number} — meaning, recitation and bookmark`}
      className={`mx-0.5 inline-flex h-[30px] w-[30px] -translate-y-0.5 items-center justify-center rounded-full border-[1.5px] align-middle font-semibold text-[#96681A] transition-colors hover:bg-gold-soft ${
        bookmarked ? "border-gold bg-gold-soft" : "border-gold/70"
      }`}
      style={{ fontSize: "13px", lineHeight: 1 }}
    >
      {arabicDigits(number)}
    </button>
  );
}

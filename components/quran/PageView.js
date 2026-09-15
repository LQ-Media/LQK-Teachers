"use client";

import Icon from "@/components/Icon";
import ArabicBody from "./ArabicBody";
import {
  arabicDigits,
  buildPageBlocks,
  chaptersOnPage,
  juzOfPage,
} from "@/lib/quran/pages";

/**
 * One printed page of the mushaf.
 *
 * Deliberately NOT a list of ayah cards with the gaps closed up. A page is
 * read as one continuous body of text — that is the whole reason a teacher
 * asks for page mode — so the verses of a surah run together, justified, with
 * only the ayah medallion between them, and a surah that begins mid-page gets
 * the ornamental band and basmalah it has in print.
 *
 * What this does not claim to be is a facsimile. Matching the printed mushaf
 * line for line needs its per-page fonts; here the LINE breaks are the
 * browser's, while the PAGE breaks are the mushaf's real ones. That is the
 * boundary that matters for "read up to page 25".
 *
 * Because the line breaks are the browser's, the left edge is left ragged.
 * Forcing it flush is the one thing that would make this look LESS like the
 * mushaf, not more — see the note on the verse paragraph below.
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
}) {
  const blocks = buildPageBlocks(verses);
  const juz = juzOfPage(verses);
  const names = chaptersOnPage(verses)
    .map((id) => chapters.find((c) => c.id === id))
    .filter(Boolean);

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

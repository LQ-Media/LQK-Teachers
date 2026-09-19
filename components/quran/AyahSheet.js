"use client";

import Icon from "@/components/Icon";
import { chapterOfVerse } from "@/lib/quran/pages";

/**
 * One ayah, opened by tapping its marker on a mushaf page.
 *
 * Page mode shows the Arabic alone, which is the point of it — but a teacher
 * preparing a lesson still needs the meaning of the line they just stopped at,
 * and a way to hear it or mark their place. Putting those here keeps them one
 * tap away without printing anything over the page.
 */
export default function AyahSheet({ verse, chapter, state, store, onClose }) {
  const { settings, playback } = state;
  const isCurrent = playback.verseKey === verse.verseKey;
  const isPlaying = isCurrent && (playback.playing || playback.loading);
  const isBookmarked = !!state.bookmark && state.bookmark.verseKey === verse.verseKey;
  const surahName = chapter ? chapter.nameSimple : `Surah ${chapterOfVerse(verse.verseKey)}`;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`${surahName}, ayah ${verse.number}`}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-t-[24px] bg-white p-4 shadow-[0_-8px_24px_rgba(74,51,64,0.18)]"
      >
        <div className="mx-auto mb-3.5 h-1.5 w-11 flex-none rounded-pill bg-line" />

        <div className="flex-none pb-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-soft">
            {surahName} · Ayah {verse.number}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-0.5">
          <p
            className="font-arabic text-right"
            lang="ar"
            dir="rtl"
            style={{ fontSize: `${settings.arabicSize}px`, lineHeight: 2.1, color: settings.arabicColor }}
          >
            {verse.textUthmani}
          </p>

          {verse.transliteration && (
            <p
              className="mt-3.5 font-semibold leading-relaxed"
              style={{ fontSize: `${settings.translitSize}px`, color: settings.translitColor }}
            >
              {verse.transliteration}
            </p>
          )}

          {verse.translation && (
            <p
              className="mt-2.5 leading-relaxed"
              style={{ fontSize: `${settings.translationSize}px`, color: settings.translationColor }}
            >
              {verse.translation}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-none items-center gap-2.5 border-t-[0.5px] border-line pt-3.5">
          <button
            type="button"
            onClick={() => store.togglePlay(verse.verseKey)}
            className="flex flex-1 items-center justify-center gap-2 rounded-control bg-ink px-4 py-2.5 text-[14px] font-semibold text-paper transition-colors hover:bg-ink-deep"
          >
            <Icon name={isPlaying ? "pause" : "play"} size={15} />
            {isPlaying ? "Pause" : "Play this ayah"}
          </button>
          <button
            type="button"
            onClick={() => store.setBookmark(verse.verseKey)}
            aria-pressed={isBookmarked}
            className={`flex items-center gap-2 rounded-control border-[0.5px] px-4 py-2.5 text-[13px] font-semibold transition-colors ${
              isBookmarked
                ? "border-gold bg-gold-soft text-[#96681A]"
                : "border-line bg-white text-charcoal hover:bg-paper-deep"
            }`}
          >
            <Icon name="bookmark" size={15} filled={isBookmarked} />
            {isBookmarked ? "Saved" : "Bookmark"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-charcoal-soft transition-colors hover:bg-paper-deep"
          >
            <Icon name="x" size={17} />
          </button>
        </div>
      </div>
    </>
  );
}

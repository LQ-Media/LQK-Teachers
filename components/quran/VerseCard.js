"use client";

import { memo } from "react";
import Icon from "@/components/Icon";
import ArabicBody from "./ArabicBody";

/**
 * A single ayah. Memoised on granular props (not the whole store state) so that
 * during recitation only the currently playing verse re-renders as the
 * word-sync index advances — the rest of the surah stays untouched.
 */
function VerseCard({
  verse,
  store,
  displayMode,
  settings,
  showTransliteration,
  showTranslation,
  isActive,
  isPlaying,
  isBookmarked,
  wordIndex,
  onWordTap,
  cardRef,
}) {
  const arabicStyle = {
    fontSize: `${settings.arabicSize}px`,
    lineHeight: 2.1,
    color: settings.arabicColor,
  };

  return (
    <article
      ref={cardRef}
      data-verse-key={verse.verseKey}
      className={`-mx-3 rounded-xl border-b-[0.5px] border-line px-3 py-5 transition-colors ${
        isActive ? "bg-gold-soft/25" : ""
      }`}
    >
      <div className="flex items-start gap-1.5">
        {/* Quiet per-ayah controls, NU-style at the left of the Arabic line */}
        <div className="flex flex-none flex-col gap-1 pt-1.5">
          <GhostButton
            on={isBookmarked}
            tone="gold"
            label={isBookmarked ? "Bookmarked" : "Bookmark this ayah"}
            title="Save your place"
            onClick={() => store.setBookmark(verse.verseKey)}
          >
            <Icon name="bookmark" size={15} filled={isBookmarked} />
          </GhostButton>
          <GhostButton
            on={isPlaying}
            label={isPlaying ? "Pause" : "Play this ayah"}
            onClick={() => store.togglePlay(verse.verseKey)}
          >
            <Icon name={isPlaying ? "pause" : "play"} size={14} />
          </GhostButton>
        </div>

        <p className="font-arabic min-w-0 flex-1 text-right" lang="ar" dir="rtl" style={arabicStyle}>
          <ArabicBody
            verse={verse}
            displayMode={displayMode}
            wordIndex={wordIndex}
            onWordTap={onWordTap}
          />{" "}
          <AyahMedallion number={verse.number} />
        </p>
      </div>

      {(showTransliteration || showTranslation) && (verse.transliteration || verse.translation) && (
        <div className="mt-3 space-y-2">
          {showTransliteration && verse.transliteration && (
            <p
              className="font-semibold leading-relaxed"
              style={{ fontSize: `${settings.translitSize}px`, color: settings.translitColor }}
            >
              {verse.transliteration}
            </p>
          )}
          {showTranslation && verse.translation && (
            <p
              className="leading-relaxed"
              style={{ fontSize: `${settings.translationSize}px`, color: settings.translationColor }}
            >
              {verse.translation}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

/** Ornamental ayah-end marker with the number in Arabic-Indic digits. */
function AyahMedallion({ number }) {
  const arabic = String(number).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
  return (
    <span
      className="mx-1 inline-flex h-[30px] w-[30px] -translate-y-0.5 items-center justify-center rounded-full border-[1.5px] border-gold/70 align-middle font-semibold text-[#96681A]"
      style={{ fontSize: "13px", lineHeight: 1 }}
      aria-label={`Ayah ${number}`}
    >
      {arabic}
    </span>
  );
}

function GhostButton({ on, tone, label, title, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title || label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-out active:scale-95 ${
        on
          ? tone === "gold"
            ? "text-gold"
            : "bg-ink text-paper"
          : "text-charcoal-soft/60 hover:bg-paper-deep hover:text-charcoal"
      }`}
    >
      {children}
    </button>
  );
}

export default memo(VerseCard);

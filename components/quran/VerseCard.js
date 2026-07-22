"use client";

import { memo, useMemo } from "react";
import Icon from "@/components/Icon";
import { parseTajweed, tajweedRule } from "@/lib/quran/tajweed";
import { tokeniseMakhraj, MAKHRAJ_REGIONS } from "@/lib/quran/makhraj";

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
      className={`bg-white rounded-card p-5 mb-4 border-[0.5px] transition-colors ${
        isActive ? "border-ink ring-1 ring-ink" : "border-line"
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="bg-sage-soft text-sage text-[11px] font-bold rounded-pill px-2.5 py-1">
          Ayah {verse.number}
        </span>
        <div className="ml-auto flex gap-2">
          <IconButton
            on={isBookmarked}
            label={isBookmarked ? "Bookmarked" : "Bookmark this ayah"}
            title="Save your place"
            onClick={() => store.setBookmark(verse.verseKey)}
          >
            <Icon name="bookmark" size={15} filled={isBookmarked} />
          </IconButton>
          <IconButton
            on={isPlaying}
            label={isPlaying ? "Pause" : "Play this ayah"}
            onClick={() => store.togglePlay(verse.verseKey)}
          >
            <Icon name={isPlaying ? "pause" : "play"} size={14} />
          </IconButton>
        </div>
      </div>

      <p className="font-arabic text-right" lang="ar" dir="rtl" style={arabicStyle}>
        <ArabicBody
          verse={verse}
          displayMode={displayMode}
          wordIndex={wordIndex}
          arabicColor={settings.arabicColor}
          onWordTap={onWordTap}
        />
      </p>

      {(showTransliteration || showTranslation) && (verse.transliteration || verse.translation) && (
        <div className="border-t-[0.5px] border-line mt-4 pt-3 space-y-1.5">
          {showTransliteration && verse.transliteration && (
            <p
              className="italic"
              style={{ fontSize: `${settings.translitSize}px`, color: settings.translitColor }}
            >
              {verse.transliteration}
            </p>
          )}
          {showTranslation && verse.translation && (
            <p style={{ fontSize: `${settings.translationSize}px`, color: settings.translationColor }}>
              {verse.translation}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

/** The Arabic line, rendered per display mode. */
function ArabicBody({ verse, displayMode, wordIndex, arabicColor, onWordTap }) {
  // Tajweed — colour by rule. Falls back to plain text if the field is absent.
  const tajweedTokens = useMemo(
    () => (displayMode === "tajweed" ? parseTajweed(verse.textTajweed) : null),
    [displayMode, verse.textTajweed]
  );
  // Makhraj — colour each letter by articulation region.
  const makhrajTokens = useMemo(
    () => (displayMode === "makhraj" ? tokeniseMakhraj(verse.textUthmani) : null),
    [displayMode, verse.textUthmani]
  );

  if (displayMode === "tajweed") {
    if (!tajweedTokens || tajweedTokens.length === 0) return verse.textUthmani;
    return tajweedTokens.map((t, i) => (
      <span key={i} style={t.rule ? { color: tajweedRule(t.rule).color } : undefined}>
        {t.text}
      </span>
    ));
  }

  if (displayMode === "makhraj") {
    return makhrajTokens.map((t, i) => (
      <span key={i} style={t.region ? { color: MAKHRAJ_REGIONS[t.region].color } : undefined}>
        {t.text}
      </span>
    ));
  }

  // Plain — word-by-word, tappable for meaning, with live word-sync highlight.
  if (verse.words.length === 0) return verse.textUthmani;
  return verse.words.map((w, i) => {
    const highlighted = i === wordIndex;
    return (
      <span key={i}>
        <span
          role="button"
          tabIndex={0}
          className={`cursor-pointer rounded px-0.5 transition-colors hover:bg-gold-soft/50 focus:bg-gold-soft/50 focus:outline-none ${
            highlighted ? "bg-gold-soft" : ""
          }`}
          style={highlighted ? { color: "var(--color-ink-deep)" } : undefined}
          onClick={() => onWordTap(w)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onWordTap(w);
            }
          }}
        >
          {w.text}
        </span>{" "}
      </span>
    );
  });
}

function IconButton({ on, label, title, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title || label}
      onClick={onClick}
      className={`w-9 h-9 rounded-full text-[13px] flex items-center justify-center border-[0.5px] transition-colors ${
        on
          ? "bg-ink border-ink text-paper"
          : "bg-white border-line text-charcoal-soft hover:bg-paper-deep hover:text-charcoal"
      }`}
    >
      {children}
    </button>
  );
}

export default memo(VerseCard);

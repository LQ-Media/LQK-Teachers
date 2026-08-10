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
            arabicColor={settings.arabicColor}
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

"use client";

import { useMemo } from "react";
import { parseTajweed, tajweedRule } from "@/lib/quran/tajweed";
import { tokeniseMakhraj, MAKHRAJ_REGIONS } from "@/lib/quran/makhraj";

/**
 * The Arabic of one ayah, rendered per display mode.
 *
 * Shared by both layouts — the ayah card and the mushaf page — so tajweed
 * colouring, makhraj colouring and tap-a-word-for-its-meaning behave
 * identically whichever way a teacher is reading.
 */
export default function ArabicBody({ verse, displayMode, wordIndex, onWordTap }) {
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
  if (!verse.words || verse.words.length === 0) return verse.textUthmani;
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

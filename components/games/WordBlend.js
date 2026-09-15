"use client";

import { useCallback, useEffect, useState } from "react";

import GameShell from "@/components/games/GameShell";
import Glyph from "@/components/games/Glyph";
import Mascot from "@/components/games/Mascot";
import Icon from "@/components/Icon";
import { HARAKAT, HURUF, sayFor } from "@/lib/games/huruf";
import { CARD_SETS, ayahOf, cardSet, meaningOf, syllables } from "@/lib/games/words";
import { buzz, chime, fanfare, sayLetter, speakArabic, unlockAudio } from "@/lib/games/audio";

/**
 * Word Blending — joining letters into a word.
 *
 * This is the step where children stall. They know ba, they know na, they know
 * ta, and بَنَتَ still defeats them, because reading a word is not three
 * separate acts of recognition — it is one act of joining. So the game makes
 * the joining the thing you do: touch each unit in reading order, right to
 * left, and each one lights and sounds as you reach it. When the last one is
 * touched the whole word says itself in one breath.
 *
 * Touch order is enforced. Tapping the middle unit first does nothing, because
 * a child who reads بَنَتَ as "na-ba-ta" has not read it.
 *
 * TWO SETS
 *
 * The deck's 12 printed combination cards, and 20 cards of three-letter words
 * mined from the Quran. The printed cards drill the letters children confuse
 * and are half nonsense on purpose; the Quran cards drill the same joining with
 * words that mean something, and show the meaning and the ayah when the word
 * is finished. A teacher picks between them in one tap, because which one she
 * wants depends on whether today is about decoding or about vocabulary.
 */

const SET_KEY = "lqk_games_wordset";

// Reverse-lookup from an Arabic letter to its deck entry, so a unit pulled out
// of a word can find its own name, harakah and audio clip.
const BY_CHAR = new Map(HURUF.map((h) => [h.char, h]));
const BY_MARK = new Map(HARAKAT.map((h) => [h.mark, h]));

/** "بَ" → { letter, harakah, say } for whatever the game can identify. */
function readUnit(unit) {
  const chars = [...unit];
  const letter = BY_CHAR.get(chars[0]) ?? null;
  const harakah = chars.slice(1).map((c) => BY_MARK.get(c)).find(Boolean) ?? null;
  return {
    letter,
    harakah,
    say: letter && harakah ? sayFor(letter, harakah.id) : letter?.name ?? unit,
  };
}

/* Who is on screen. Used for the mascot AND for the default reciting voice,
   from one place so the chip in the header can never disagree with the face
   in the corner. */
const MASCOT = "ustaz";

export default function WordBlend() {
  const [setId, setSetId] = useState(CARD_SETS[0].id);
  const [cardIndex, setCardIndex] = useState(0);
  const [wordIndex, setWordIndex] = useState(0);
  const [reached, setReached] = useState(0);
  const [beat, setBeat] = useState(0);
  const [wrong, setWrong] = useState(false);

  const set = cardSet(setId);
  const card = set.cards[cardIndex] ?? set.cards[0];
  const word = card.words[wordIndex] ?? card.words[0];
  const meaning = meaningOf(word);
  const ayah = ayahOf(word);
  // Not memoised: splitting a six-character string is cheaper than the compare
  // that would guard it, and wrapping it made the React compiler give up on
  // memoising this component at all.
  const units = syllables(word);
  const complete = reached >= units.length;

  /* Read after mount, not during render: localStorage does not exist on the
     server and a mismatch there is a hydration error. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SET_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && CARD_SETS.some((s) => s.id === saved)) setSetId(saved);
    } catch {
      // private mode — the deck is the default
    }
  }, []);

  const reset = useCallback(() => {
    setReached(0);
    setWrong(false);
  }, []);

  const chooseSet = useCallback(
    (id) => {
      setSetId(id);
      setCardIndex(0);
      setWordIndex(0);
      reset();
      try {
        localStorage.setItem(SET_KEY, id);
      } catch {
        // ignore — the choice still holds for this session
      }
    },
    [reset],
  );

  function goWord(delta) {
    const flat = cardIndex * 4 + wordIndex + delta;
    const total = set.cards.length * 4;
    const at = (flat + total) % total;
    setCardIndex(Math.floor(at / 4));
    setWordIndex(at % 4);
    reset();
  }

  function touch(i) {
    unlockAudio();
    if (complete) return;

    if (i !== reached) {
      // Out of order: a small nudge and nothing else. No penalty, no reset of
      // the units already joined.
      setWrong(true);
      setBeat((b) => b + 1);
      chime({ freq: 300, duration: 0.14, gain: 0.09 });
      setTimeout(() => setWrong(false), 450);
      return;
    }

    const unit = readUnit(units[i]);
    setWrong(false);
    setReached(i + 1);
    buzz(14);

    if (unit.letter) {
      sayLetter({
        letterId: unit.letter.id,
        harakahId: unit.harakah?.id ?? null,
        arabic: units[i],
      });
    } else {
      chime({ freq: 640 });
    }

    if (i + 1 >= units.length) {
      setBeat((b) => b + 1);
      // The whole word, after a pause long enough to be heard as a separate
      // thing from the last syllable — that gap is what "blending" sounds like.
      // There is no clip for a whole drill word, so this is the device voice or
      // nothing; either way the flourish plays, so the join is always marked.
      setTimeout(() => {
        speakArabic(word);
        fanfare();
      }, 620);
    }
  }

  return (
    <GameShell
      title="Word Blending"
      mascot={MASCOT}
      subtitle={`${card.title} — ${cardIndex + 1} of ${set.cards.length}`}
    >
      <div className="flex h-full flex-col">
        {/* The word. Right to left, one box per readable unit, each lighting as
            it is reached. */}
        <div dir="rtl" className="flex min-h-0 flex-1 items-center justify-center gap-2 p-3">
          {units.map((u, i) => {
            const lit = i < reached;
            const isNext = i === reached && !complete;
            return (
              <button
                key={`${word}-${i}`}
                type="button"
                onClick={() => touch(i)}
                aria-label={readUnit(u).say}
                className={`flex aspect-[2/3] max-h-full min-w-0 flex-1 flex-col items-center justify-center rounded-card border-2 transition-all duration-300 ${
                  lit
                    ? "border-gold bg-gold-soft"
                    : isNext
                      ? "border-gold/50 bg-white"
                      : "border-line bg-white"
                } ${complete ? "lqk-bloom" : ""} ${wrong && isNext ? "lqk-oops" : ""}`}
                style={
                  lit
                    ? { boxShadow: "0 0 26px rgba(240,164,31,0.55)" }
                    : undefined
                }
              >
                <Glyph
                  size={54}
                  className={`w-full max-h-[34vh] transition-colors ${
                    lit ? "text-ink" : "text-charcoal-soft/60"
                  }`}
                >
                  {u}
                </Glyph>
                <span
                  className={`mt-1.5 font-heading text-[15px] font-bold transition-opacity ${
                    lit ? "opacity-100 text-ink" : "opacity-0"
                  }`}
                >
                  {readUnit(u).say}
                </span>
                {isNext && (
                  <span className="mt-1 h-1.5 w-8 rounded-pill bg-gold/60" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        {/* The whole word, once joined. */}
        <div className="relative flex h-24 flex-shrink-0 items-center justify-center">
          {complete ? (
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                speakArabic(word);
              }}
              className="lqk-bloom flex max-w-full items-center gap-3 rounded-pill bg-gold-soft px-6 py-2 text-ink"
            >
              <Icon name="volume-2" size={22} />
              <span dir="rtl" className="font-mirza text-[34px] leading-none">
                {word}
              </span>
              {/* Transliteration above, meaning below: the child reads the
                  first and the ustazah reads the second. The meaning is only
                  here when there is one — the printed deck is half nonsense
                  drills by design, and those are left unglossed rather than
                  guessed at. The ayah rides alongside it so an ustazah can
                  check the word against the mushaf without leaving the game. */}
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span className="font-heading text-[17px] font-bold">
                  {units.map((u) => readUnit(u).say).join("-")}
                </span>
                {meaning && (
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-[12px] font-semibold text-charcoal-soft">
                      {meaning}
                    </span>
                    {ayah && (
                      <span className="flex-shrink-0 rounded-pill bg-white/70 px-1.5 text-[10px] font-bold tabular-nums text-charcoal-soft">
                        {ayah}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          ) : (
            <p className="text-[13px] text-charcoal-soft">
              Touch the letters from the right, one at a time
            </p>
          )}
          <Mascot
            who={MASCOT}
            mood={complete ? "cheer" : wrong ? "oops" : "idle"}
            beat={beat}
            className="absolute bottom-0 right-3 h-24 w-auto opacity-90"
          />
        </div>

        {/* Which set of cards. Two taps from "drill the confusable letters" to
            "learn some words", because that is the choice an ustazah actually
            makes when she picks this game up. */}
        <div className="flex flex-shrink-0 items-center gap-2 border-t border-line bg-white px-3 pt-2">
          <div
            className="flex flex-shrink-0 rounded-pill bg-paper-deep p-0.5"
            role="group"
            aria-label="Word set"
          >
            {CARD_SETS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => chooseSet(s.id)}
                aria-pressed={s.id === setId}
                title={s.hint}
                className={`rounded-pill px-3 py-1.5 text-[12px] font-bold transition-colors ${
                  s.id === setId ? "bg-white text-ink shadow-sm" : "text-charcoal-soft"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="min-w-0 flex-1 truncate text-right text-[11px] text-charcoal-soft">
            {set.hint}
          </p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => goWord(-1)}
            aria-label="Previous word"
            className="flex h-11 w-11 items-center justify-center rounded-control text-charcoal-soft hover:bg-paper-deep"
          >
            <Icon name="chevron-right" size={20} />
          </button>

          {/* The four words of the current card, so an ustazah can jump between
              the active and passive forms the card is built to contrast. */}
          <div dir="rtl" className="flex flex-1 gap-1.5">
            {card.words.map((w, i) => (
              <button
                key={`${w}-${i}`}
                type="button"
                onClick={() => {
                  setWordIndex(i);
                  reset();
                }}
                className={`flex-1 rounded-control border py-2 font-mirza text-[19px] leading-none transition-colors ${
                  i === wordIndex
                    ? "border-gold bg-gold-soft text-ink"
                    : "border-line bg-paper text-charcoal hover:bg-paper-deep"
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => goWord(1)}
            aria-label="Next word"
            className="flex h-11 w-11 items-center justify-center rounded-control text-charcoal-soft hover:bg-paper-deep"
          >
            <Icon name="chevron-left" size={20} />
          </button>
        </div>
      </div>
    </GameShell>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";

import GameShell from "@/components/games/GameShell";
import Glyph from "@/components/games/Glyph";
import Mascot from "@/components/games/Mascot";
import Icon from "@/components/Icon";
import { HARAKAT, HURUF, sayFor } from "@/lib/games/huruf";
import { WORD_CARDS, syllables } from "@/lib/games/words";
import { buzz, chime, fanfare, sayLetter, speakArabic, unlockAudio } from "@/lib/games/audio";

/**
 * Word Blending — the 12 combination cards from the back of the deck.
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
 */

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

export default function WordBlend() {
  const [cardIndex, setCardIndex] = useState(0);
  const [wordIndex, setWordIndex] = useState(0);
  const [reached, setReached] = useState(0);
  const [beat, setBeat] = useState(0);
  const [wrong, setWrong] = useState(false);

  const card = WORD_CARDS[cardIndex];
  const word = card.words[wordIndex];
  const units = useMemo(() => syllables(word), [word]);
  const complete = reached >= units.length;

  const reset = useCallback(() => {
    setReached(0);
    setWrong(false);
  }, []);

  function goWord(delta) {
    const flat = cardIndex * 4 + wordIndex + delta;
    const total = WORD_CARDS.length * 4;
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
      subtitle={`Card ${card.id} of ${WORD_CARDS.length} — touch each letter in order`}
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
              className="lqk-bloom flex items-center gap-3 rounded-pill bg-gold-soft px-6 py-2.5 text-ink"
            >
              <Icon name="volume-2" size={22} />
              <span dir="rtl" className="font-mirza text-[34px] leading-none">
                {word}
              </span>
              <span className="font-heading text-[17px] font-bold">
                {units.map((u) => readUnit(u).say).join("-")}
              </span>
            </button>
          ) : (
            <p className="text-[13px] text-charcoal-soft">
              Touch the letters from the right, one at a time
            </p>
          )}
          <Mascot
            who="ustaz"
            mood={complete ? "cheer" : wrong ? "oops" : "idle"}
            beat={beat}
            className="absolute bottom-0 right-3 h-24 w-auto opacity-90"
          />
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 border-t border-line bg-white px-3 py-2">
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
                key={w}
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

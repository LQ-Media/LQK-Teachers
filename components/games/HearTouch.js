"use client";

import { useCallback, useRef, useState } from "react";

import GameShell from "@/components/games/GameShell";
import Glyph from "@/components/games/Glyph";
import Mascot from "@/components/games/Mascot";
import Icon from "@/components/Icon";
import { HARAKAT, HURUF, huruf, sayFor, withHarakah } from "@/lib/games/huruf";
import { buzz, fanfare, nudge, sayUnits, unlockAudio } from "@/lib/games/audio";

/**
 * Hear & Touch — the listening game, and the only one that runs the other way.
 *
 * A sound plays; four cards are on screen; the child touches the one they
 * heard. No tracing, no reading of a transliteration — the only route from the
 * question to the answer is the ear, which is why this game is the one that
 * shows whether the sounds have actually landed.
 *
 * WHAT MAKES THE CHOICES HARD IN THE RIGHT WAY
 *
 * The three wrong cards are not random letters. They are drawn from the letters
 * a child actually confuses: the same shape with different dots (ب ت ث), and
 * the same letter with a different harakah. A round of ب against و teaches
 * nothing, because it can be won without listening properly.
 */

// Letters that share a skeleton and differ only in their dots — the confusions
// worth drilling. Every letter in a group is a plausible wrong answer for the
// others, which is exactly what a distractor should be.
const SHAPE_FAMILIES = [
  ["ba", "ta", "tsa", "nun", "ya"],
  ["jim", "ha", "kho"],
  ["dal", "dzal"],
  ["ro", "zay"],
  ["sin", "syin"],
  ["shod", "dhod"],
  ["tho", "zho"],
  ["ain", "ghoin"],
  ["fa", "qof"],
];

function familyOf(id) {
  return SHAPE_FAMILIES.find((f) => f.includes(id)) ?? [];
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How many units a card holds at each level, and how many right to move on. */
const UNITS_PER_LEVEL = [1, 2, 3];
const TO_ADVANCE = 10;

function randomUnit() {
  const letter = HURUF[Math.floor(Math.random() * HURUF.length)];
  const harakah = HARAKAT[Math.floor(Math.random() * HARAKAT.length)];
  return { letterId: letter.id, harakahId: harakah.id };
}

const keyOf = (units) => units.map((u) => `${u.letterId}-${u.harakahId}`).join("+");

/**
 * A confusable alternative to one unit — the same letter with a different
 * vowel, or a letter from the same shape family. Never a random letter: a
 * round of ب against و can be won without listening.
 */
function confusable(unit) {
  const family = familyOf(unit.letterId).filter((id) => id !== unit.letterId);
  const otherHarakat = HARAKAT.map((h) => h.id).filter((id) => id !== unit.harakahId);
  const swapVowel = () => ({
    letterId: unit.letterId,
    harakahId: otherHarakat[Math.floor(Math.random() * otherHarakat.length)],
  });
  const swapLetter = () => ({
    letterId: family[Math.floor(Math.random() * family.length)],
    harakahId: HARAKAT[Math.floor(Math.random() * HARAKAT.length)].id,
  });
  if (!family.length) return swapVowel();
  return Math.random() < 0.5 ? swapVowel() : swapLetter();
}

/**
 * One question at a given level: the answer sequence plus three distractors,
 * in random card order.
 *
 * Each distractor differs from the answer in exactly ONE unit. That is what
 * makes the longer levels a listening test rather than a memory test — the
 * child cannot win by catching only the first sound, because three of the four
 * cards start the same way as often as not.
 */
function buildRound(level, previousKey) {
  const size = UNITS_PER_LEVEL[level] ?? 1;

  let answer;
  do {
    answer = Array.from({ length: size }, randomUnit);
  } while (keyOf(answer) === previousKey);

  const options = [answer];
  const seen = new Set([keyOf(answer)]);

  // Vary one position at a time, cycling through the positions so a long
  // sequence gets distractors spread across it rather than all at the start.
  for (let attempt = 0; attempt < 40 && options.length < 4; attempt++) {
    const at = attempt % size;
    const candidate = answer.map((u, i) => (i === at ? confusable(u) : u));
    const key = keyOf(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(candidate);
  }

  // A one-unit answer with no shape family (ا ل م ه و ك) can run out of
  // confusable neighbours, so the last cards come from anywhere.
  while (options.length < 4) {
    const candidate = Array.from({ length: size }, randomUnit);
    const key = keyOf(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(candidate);
  }

  return { answer, options: shuffle(options) };
}

/** The units of a card, with the Arabic and the deck's transliteration. */
function readCard(units) {
  return units.map((u) => {
    const letter = huruf(u.letterId);
    return {
      ...u,
      arabic: withHarakah(letter, u.harakahId),
      say: sayFor(letter, u.harakahId),
    };
  });
}

/* Who is on screen. Used for the mascot AND for the default reciting voice,
   from one place so the chip in the header can never disagree with the face
   in the corner. */
const MASCOT = "ustazah";

export default function HearTouch() {
  const [round, setRound] = useState(null);
  const [picked, setPicked] = useState(null);
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const [beat, setBeat] = useState(0);
  const previous = useRef(null);

  const size = UNITS_PER_LEVEL[level];

  /* The prompt is spoken UNIT BY UNIT, never as one string. At level 2 and 3 a
     card holds two or three sounds, and a speech engine handed "بَتَ" reads it
     as a word — which is the one thing this game must not do, because the
     child is being asked to hear the parts. */
  const play = useCallback((q) => {
    sayUnits(readCard(q.answer));
  }, []);

  const deal = useCallback(
    (forLevel) => {
      const q = buildRound(forLevel, previous.current);
      previous.current = keyOf(q.answer);
      setPicked(null);
      setRound(q);
      // A beat of silence before the prompt, or it collides with the sound of
      // the round just finished.
      setTimeout(() => play(q), 380);
    },
    [play],
  );

  // The first round waits for a tap rather than starting on mount: iOS will not
  // let a page make sound before a gesture, and a question the child never
  // heard is a question they cannot answer.
  function start() {
    unlockAudio();
    deal(level);
  }

  /**
   * A card was touched.
   *
   * WRONG CLEARS EVERYTHING AND DEALS AGAIN, IMMEDIATELY
   *
   * It used to mark the pick and replay the prompt, leaving `picked` set — and
   * because every tap began with `if (picked) return`, the second try was
   * silently ignored. A wrong answer left the game unusable until you
   * navigated away, which is exactly how it was reported.
   *
   * Asked for: a wrong touch now resets the run to zero and deals a fresh
   * round on the spot. Ten right in a row moves up a level.
   */
  function choose(units) {
    if (picked || !round) return;
    unlockAudio();
    const correct = keyOf(units) === keyOf(round.answer);
    setBeat((b) => b + 1);

    if (!correct) {
      setPicked({ key: keyOf(units), correct: false });
      nudge();
      buzz(60);
      setScore(0);
      setTimeout(() => deal(level), 650);
      return;
    }

    setPicked({ key: keyOf(units), correct: true });
    const next = score + 1;
    const levelUp = next >= TO_ADVANCE && level < UNITS_PER_LEVEL.length - 1;
    fanfare();
    buzz([20, 40, 20]);

    if (levelUp) {
      setScore(0);
      setLevel(level + 1);
      setTimeout(() => deal(level + 1), 1500);
      return;
    }
    setScore(next);
    setTimeout(() => deal(level), 1500);
  }

  const cleared = score >= TO_ADVANCE && level === UNITS_PER_LEVEL.length - 1;

  return (
    <GameShell
      title="Hear &amp; Touch"
      mascot={MASCOT}
      subtitle={
        round
          ? `Level ${level + 1} — ${size} ${size === 1 ? "sound" : "sounds"} · ${score} of ${TO_ADVANCE}`
          : "Listen, then touch"
      }
    >
      <div className="relative flex h-full flex-col">
        {/* The prompt. Big and central, because it is the question — and
            tappable, because "again" is the single most common request. */}
        <div className="relative flex flex-shrink-0 flex-col items-center gap-2 py-3">
          <button
            type="button"
            onClick={() => (round ? play(round) : start())}
            className="flex items-center gap-3 rounded-pill bg-ink px-7 py-4 text-paper transition-colors hover:bg-ink-deep"
          >
            <Icon name="volume-2" size={26} />
            <span className="font-heading text-[19px] font-bold">
              {round ? "Play it again" : "Start listening"}
            </span>
          </button>

          {/* Ten lamps rather than a number: a child who cannot read a score
              can still see how much of the row is filled, and a wrong answer
              emptying it is legible without a word of explanation. */}
          {round && (
            <div className="flex items-center gap-1.5" aria-label={`${score} of ${TO_ADVANCE}`}>
              {Array.from({ length: TO_ADVANCE }, (_, i) => (
                <span
                  key={i}
                  className={`h-2 w-2 rounded-pill transition-colors ${
                    i < score ? "bg-gold" : "bg-line"
                  }`}
                />
              ))}
              {cleared && (
                <span className="ml-1 font-heading text-[12px] font-bold text-ink">All three!</span>
              )}
            </div>
          )}
        </div>

        <div dir="rtl" className="grid min-h-0 flex-1 grid-cols-2 gap-2.5 p-3">
          {(round?.options ?? []).map((units) => {
            const card = readCard(units);
            const key = keyOf(units);
            const isPicked = picked?.key === key;
            const revealed = picked?.correct && key === keyOf(round.answer);
            return (
              <button
                key={key}
                type="button"
                onClick={() => choose(units)}
                className={`flex flex-col items-center justify-center rounded-card border-2 transition-colors ${
                  revealed
                    ? "lqk-bloom border-gold bg-gold-soft"
                    : isPicked
                      ? "border-rust bg-rust-soft"
                      : "border-line bg-white hover:bg-paper-deep"
                }`}
              >
                {/* One run of text, so the browser shapes the sequence the way
                    a mushaf would — بَتَ joined, not two loose letters. The ear
                    still gets them separately. */}
                <Glyph size={52} className="h-full max-h-[30vh] w-auto text-ink">
                  {card.map((u) => u.arabic).join("")}
                </Glyph>
                {/* The transliteration appears only after an answer: showing it
                    up front would turn a listening game into a reading one. */}
                <span
                  className={`mt-1 font-heading text-[15px] font-bold transition-opacity ${
                    picked ? "opacity-100" : "opacity-0"
                  } ${revealed ? "text-ink" : "text-charcoal-soft"}`}
                >
                  {card.map((u) => u.say).join("-")}
                </span>
              </button>
            );
          })}

          {!round && (
            <p className="col-span-2 self-center text-center text-[13px] text-charcoal-soft">
              Press <strong>Start listening</strong> and touch the letter you hear.
              <br />
              Ten in a row moves you up: one sound, then two, then three.
            </p>
          )}
        </div>

        {/* An overlay rather than a row of her own: given a row, she competed
            with the answer cards for the same vertical space and lost, and was
            cropped at the knees. Overlaid, the cards get the whole area and she
            cannot affect the layout at all. */}
        <Mascot
          who={MASCOT}
          mood={picked ? (picked.correct ? "cheer" : "oops") : "idle"}
          beat={beat}
          className="absolute bottom-1 left-1 z-10 h-20 w-auto opacity-90"
        />
      </div>
    </GameShell>
  );
}

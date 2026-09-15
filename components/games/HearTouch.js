"use client";

import { useCallback, useRef, useState } from "react";

import GameShell from "@/components/games/GameShell";
import Glyph from "@/components/games/Glyph";
import Mascot from "@/components/games/Mascot";
import Icon from "@/components/Icon";
import { HARAKAT, HURUF, huruf, sayFor, withHarakah } from "@/lib/games/huruf";
import { buzz, fanfare, nudge, sayLetter, unlockAudio } from "@/lib/games/audio";

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

/** One question: the answer plus three distractors, in random card order. */
function buildRound(previousAnswerKey) {
  let answer;
  do {
    const letter = HURUF[Math.floor(Math.random() * HURUF.length)];
    const harakah = HARAKAT[Math.floor(Math.random() * HARAKAT.length)];
    answer = { letterId: letter.id, harakahId: harakah.id };
  } while (`${answer.letterId}-${answer.harakahId}` === previousAnswerKey);

  const options = [answer];
  const family = familyOf(answer.letterId).filter((id) => id !== answer.letterId);

  // Same letter, different harakah: tests the vowel.
  for (const h of shuffle(HARAKAT.map((h) => h.id)).filter((id) => id !== answer.harakahId)) {
    if (options.length >= 2) break;
    options.push({ letterId: answer.letterId, harakahId: h });
  }

  // Same shape family, any harakah: tests the consonant.
  for (const id of shuffle(family)) {
    if (options.length >= 4) break;
    options.push({
      letterId: id,
      harakahId: HARAKAT[Math.floor(Math.random() * HARAKAT.length)].id,
    });
  }

  // Letters with no shape family (ا ل م ه و ك) need filling out from anywhere.
  while (options.length < 4) {
    const letter = HURUF[Math.floor(Math.random() * HURUF.length)];
    const harakahId = HARAKAT[Math.floor(Math.random() * HARAKAT.length)].id;
    const key = `${letter.id}-${harakahId}`;
    if (!options.some((o) => `${o.letterId}-${o.harakahId}` === key)) {
      options.push({ letterId: letter.id, harakahId });
    }
  }

  return { answer, options: shuffle(options) };
}

/* Who is on screen. Used for the mascot AND for the default reciting voice,
   from one place so the chip in the header can never disagree with the face
   in the corner. */
const MASCOT = "ustazah";

export default function HearTouch() {
  const [round, setRound] = useState(null);
  const [picked, setPicked] = useState(null);
  const [score, setScore] = useState({ right: 0, asked: 0 });
  const [beat, setBeat] = useState(0);
  const previous = useRef(null);

  const play = useCallback((q) => {
    const letter = huruf(q.answer.letterId);
    sayLetter({
      letterId: q.answer.letterId,
      harakahId: q.answer.harakahId,
      arabic: withHarakah(letter, q.answer.harakahId),
    });
  }, []);

  const next = useCallback(() => {
    const q = buildRound(previous.current);
    previous.current = `${q.answer.letterId}-${q.answer.harakahId}`;
    setPicked(null);
    setRound(q);
    // A beat of silence before the prompt, or it collides with the reward
    // sound of the round just finished.
    setTimeout(() => play(q), 380);
  }, [play]);

  // The first round waits for a tap rather than starting on mount: iOS will not
  // let a page make sound before a gesture, and a question the child never
  // heard is a question they cannot answer.
  function start() {
    unlockAudio();
    next();
  }

  function choose(option) {
    if (picked || !round) return;
    unlockAudio();
    const correct =
      option.letterId === round.answer.letterId && option.harakahId === round.answer.harakahId;
    setPicked({ ...option, correct });
    setScore((s) => ({ right: s.right + (correct ? 1 : 0), asked: s.asked + 1 }));
    setBeat((b) => b + 1);

    if (correct) {
      fanfare();
      buzz([20, 40, 20]);
      setTimeout(next, 1500);
    } else {
      nudge();
      buzz(60);
      // Wrong answers replay the prompt rather than moving on: the point is to
      // hear it again next to what they picked, not to be marked down.
      setTimeout(() => round && play(round), 700);
    }
  }

  return (
    <GameShell
      title="Hear &amp; Touch"
      mascot={MASCOT}
      subtitle={
        score.asked > 0 ? `${score.right} of ${score.asked} heard right` : "Listen, then touch"
      }
    >
      <div className="relative flex h-full flex-col">
        {/* The prompt. Big and central, because it is the question — and
            tappable, because "again" is the single most common request. */}
        <div className="relative flex flex-shrink-0 items-center justify-center py-4">
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
        </div>

        <div dir="rtl" className="grid min-h-0 flex-1 grid-cols-2 gap-2.5 p-3">
          {(round?.options ?? []).map((o) => {
            const letter = huruf(o.letterId);
            const isPicked =
              picked && picked.letterId === o.letterId && picked.harakahId === o.harakahId;
            const revealed =
              picked?.correct &&
              o.letterId === round.answer.letterId &&
              o.harakahId === round.answer.harakahId;
            return (
              <button
                key={`${o.letterId}-${o.harakahId}`}
                type="button"
                onClick={() => choose(o)}
                className={`flex flex-col items-center justify-center rounded-card border-2 transition-colors ${
                  revealed
                    ? "lqk-bloom border-gold bg-gold-soft"
                    : isPicked
                      ? "border-rust bg-rust-soft"
                      : "border-line bg-white hover:bg-paper-deep"
                }`}
              >
                <Glyph size={52} className="h-full max-h-[34vh] w-auto text-ink">
                  {withHarakah(letter, o.harakahId)}
                </Glyph>
                {/* The transliteration appears only after an answer: showing it
                    up front would turn a listening game into a reading one. */}
                <span
                  className={`mt-1 font-heading text-[15px] font-bold transition-opacity ${
                    picked ? "opacity-100" : "opacity-0"
                  } ${revealed ? "text-ink" : "text-charcoal-soft"}`}
                >
                  {sayFor(letter, o.harakahId)}
                </span>
              </button>
            );
          })}

          {!round && (
            <p className="col-span-2 self-center text-center text-[13px] text-charcoal-soft">
              Press <strong>Start listening</strong> and touch the letter you hear.
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

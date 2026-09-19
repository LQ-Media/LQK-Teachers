"use client";

import { useCallback, useState } from "react";

import GameShell, { useLevel } from "@/components/games/GameShell";
import LetterRail from "@/components/games/LetterRail";
import Mascot from "@/components/games/Mascot";
import TraceCanvas from "@/components/games/TraceCanvas";
import Icon from "@/components/Icon";
import { FORM_LABELS, HURUF, huruf } from "@/lib/games/huruf";
import { preload, sayLetter, unlockAudio } from "@/lib/games/audio";
import { formGeometry, useForms } from "@/lib/games/useGeometry";

/**
 * Three Places — the front of each flashcard, made traceable.
 *
 * One letter at a time in its three positions: بـ at the start of a word, ـبـ
 * in the middle, ـب at the end. Trace each one; the connector is part of the
 * shape, because the join is the thing being taught.
 *
 * WHY THIS IS ITS OWN GAME
 *
 * It is the step where reading actually breaks down. A child who knows ب
 * perfectly well meets ـبـ in a word and does not recognise it, because nothing
 * in "learning the alphabet" told them that a letter changes shape according to
 * its neighbours. Trace & Say teaches the letter; this teaches that the letter
 * survives being joined.
 *
 * Every shape is a real HarfBuzz-shaped form of the same character, not a
 * hand-drawn approximation — see the note in scripts/huruf-geometry.py. Six
 * letters (ا د ذ ر ز و) never join to their left, so their "initial" is simply
 * the letter alone, exactly as the deck prints it; nothing here special-cases
 * them, because the generated geometry already tells the truth.
 */

const FORMS = ["init", "medi", "fina"];

/**
 * Stages, the same shape as Hear & Touch: ten right moves you up.
 *
 * WHAT A STAGE CANNOT BE HERE, AND WHY
 *
 * In Hear & Touch a stage adds letters to the card. That is not available in
 * this game: what a child traces is real generated geometry, and forms.json
 * holds the 84 single-letter positional forms the HarfBuzz pipeline shaped —
 * there is no traceable outline for a joined pair or triple, and there cannot
 * be one per combination, since 28 letters give 784 pairs and 21,952 triples.
 *
 * So a stage sets how many letters the game DEALS you in a round instead. The
 * work per stage stays the same ten letters; what grows is how much is put in
 * front of you at once, which is the thing a child can actually feel getting
 * harder. Free practice from the rail still works at every stage and still
 * counts.
 */
const LETTERS_PER_ROUND = [1, 2, 3];
const TO_ADVANCE = 10;

function dealRound(count, avoid) {
  const pool = HURUF.filter((h) => h.id !== avoid);
  const out = [];
  while (out.length < count && out.length < pool.length) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!out.includes(pick.id)) out.push(pick.id);
  }
  return out;
}

/* Who is on screen. Used for the mascot AND for the default reciting voice,
   from one place so the chip in the header can never disagree with the face
   in the corner. */
const MASCOT = "ustaz";

export default function ThreePlaces() {
  const { data: forms, error } = useForms();
  const [level, setLevel] = useLevel();
  const [letterId, setLetterId] = useState(HURUF[1].id); // Ba: alif's forms barely differ
  const [formIndex, setFormIndex] = useState(0);
  const [done, setDone] = useState({}); // `${letterId}:${form}` → true
  const [beat, setBeat] = useState(0);
  const [stage, setStage] = useState(0);
  const [score, setScore] = useState(0);
  const [queue, setQueue] = useState([HURUF[1].id]);

  const letter = huruf(letterId);
  const form = FORMS[formIndex];
  const geo = formGeometry(forms, letterId, form);

  const isDone = (id, f) => Boolean(done[`${id}:${f}`]);
  const letterDone = FORMS.every((f) => isDone(letterId, f));

  const onComplete = useCallback(() => {
    setBeat((b) => b + 1);
    // The letter's NAME, not a harakah sound: the point being made is that all
    // three of these shapes are still Ba.
    sayLetter({ letterId, arabic: letter.char });
    preload([letterId]);

    setDone((prev) => {
      const nextDone = { ...prev, [`${letterId}:${form}`]: true };
      /* A letter scores when its LAST position lands, so the score counts
         letters learned rather than traces performed — and re-tracing a letter
         already finished cannot farm points. */
      const wasWhole = FORMS.every((f) => prev[`${letterId}:${f}`]);
      const nowWhole = FORMS.every((f) => nextDone[`${letterId}:${f}`]);
      if (nowWhole && !wasWhole) {
        setScore((prevScore) => {
          const next = prevScore + 1;
          if (next >= TO_ADVANCE && stage < LETTERS_PER_ROUND.length - 1) {
            const up = stage + 1;
            setStage(up);
            setQueue(dealRound(LETTERS_PER_ROUND[up], letterId));
            return 0;
          }
          return next;
        });
        setQueue((q) => {
          const left = q.filter((id) => id !== letterId);
          return left.length ? left : dealRound(LETTERS_PER_ROUND[stage], letterId);
        });
      }
      return nextDone;
    });
  }, [letterId, form, letter, stage]);

  function pickLetter(id) {
    setLetterId(id);
    setFormIndex(0);
  }

  const cleared = score >= TO_ADVANCE && stage === LETTERS_PER_ROUND.length - 1;

  return (
    <GameShell
      title="Three Places"
      mascot={MASCOT}
      subtitle={`Stage ${stage + 1} · ${score} of ${TO_ADVANCE} — ${letter.name} at the start, middle and end`}
      level={level}
      onLevelChange={setLevel}
    >
      <div className="relative flex h-full flex-col">
        <LetterRail
          selectedId={letterId}
          onSelect={pickLetter}
          done={HURUF.filter((h) => FORMS.every((f) => isDone(h.id, f))).map((h) => h.id)}
        />

        {/* This round's letters and the run of ten. The queue is what the
            stage deals; tapping one jumps to it, and the rail below still
            works for free practice. */}
        <div className="flex flex-shrink-0 items-center gap-2 px-3 pt-1">
          <div dir="rtl" className="flex min-w-0 flex-1 gap-1.5">
            {queue.map((id) => {
              const q = huruf(id);
              const whole = FORMS.every((f) => isDone(id, f));
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => pickLetter(id)}
                  aria-pressed={id === letterId}
                  className={`flex items-center gap-1 rounded-pill border px-2.5 py-1 transition-colors ${
                    id === letterId
                      ? "border-gold bg-gold-soft text-ink"
                      : whole
                        ? "border-line bg-sand text-ink"
                        : "border-line bg-white text-charcoal"
                  }`}
                >
                  <span dir="rtl" className="font-mirza text-[19px] leading-none">
                    {q.char}
                  </span>
                  <span className="font-heading text-[11px] font-bold">{q.name}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1" aria-label={`${score} of ${TO_ADVANCE}`}>
            {Array.from({ length: TO_ADVANCE }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-pill ${i < score ? "bg-gold" : "bg-line"}`}
              />
            ))}
            {cleared && <span className="ml-1 font-heading text-[11px] font-bold text-ink">Done!</span>}
          </div>
        </div>

        {/* The deck's own three labels, right to left, as the step control.
            Each carries the form itself in Mirza so the three can be compared
            at a glance — which is the whole lesson — and tapping one switches
            to tracing it. */}
        <div dir="rtl" className="flex flex-shrink-0 gap-2 px-3 pb-1">
          {FORMS.map((f, i) => {
            const active = i === formIndex;
            const complete = isDone(letterId, f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFormIndex(i)}
                aria-pressed={active}
                className={`flex flex-1 items-center justify-center gap-2 rounded-control border-2 py-1.5 transition-colors ${
                  active
                    ? "border-gold bg-gold-soft text-ink"
                    : complete
                      ? "border-line bg-sand text-ink"
                      : "border-line bg-white text-charcoal"
                }`}
              >
                <span dir="rtl" className="font-mirza text-[26px] leading-none">
                  {letter.forms[i]}
                </span>
                <span className="font-heading text-[12px] font-bold uppercase tracking-wide">
                  {FORM_LABELS[i]}
                </span>
                {complete && <Icon name="check" size={14} />}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center px-2 pb-1">
          {error ? (
            <p className="max-w-sm text-center text-[13px] text-charcoal-soft">
              The letter shapes could not be loaded. Check that
              <code className="mx-1 rounded bg-paper-deep px-1">public/huruf/forms.json</code>
              is deployed.
            </p>
          ) : !geo ? (
            <p className="text-[13px] text-charcoal-soft">Loading the shapes…</p>
          ) : (
            <TraceCanvas
              // A new shape is a new component: fresh trace state, no stale
              // progress carried across from the form traced before it.
              key={`${letterId}-${form}`}
              letter={letter}
              geometry={geo}
              level={level}
              onComplete={onComplete}
              className="aspect-[1000/560] max-h-full w-full"
            />
          )}
        </div>

        <Mascot
          who={MASCOT}
          mood={letterDone ? "cheer" : "idle"}
          beat={beat}
          className="pointer-events-none absolute bottom-16 right-2 h-[15%] max-h-24 w-auto opacity-90"
        />

        {/* The letter's identity, stated once and repeatable: whichever of the
            three shapes is on screen, this is still Ba. */}
        <div className="flex flex-shrink-0 items-center gap-2 border-t border-line bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              sayLetter({ letterId, arabic: letter.char });
            }}
            className={`flex flex-1 items-center justify-center gap-2.5 rounded-control px-4 py-3 transition-colors ${
              letterDone ? "bg-gold-soft text-ink" : "bg-paper-deep text-charcoal"
            }`}
          >
            <Icon name="volume-2" size={20} />
            <span className="font-heading text-[20px] font-bold leading-none">
              {letterDone ? `All three — ${letter.name}` : `Still ${letter.name}`}
            </span>
            <span dir="rtl" className="font-mirza text-[24px] leading-none">
              {letter.char}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              const i = HURUF.findIndex((h) => h.id === letterId);
              pickLetter(HURUF[(i + 1) % HURUF.length].id);
            }}
            aria-label="Next letter"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-charcoal-soft hover:bg-paper-deep"
          >
            <Icon name="chevron-left" size={20} />
          </button>
        </div>
      </div>
    </GameShell>
  );
}

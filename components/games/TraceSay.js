"use client";

import { useCallback, useEffect, useState } from "react";

import GameShell, { useLevel } from "@/components/games/GameShell";
import LetterRail from "@/components/games/LetterRail";
import Mascot from "@/components/games/Mascot";
import TraceCanvas from "@/components/games/TraceCanvas";
import Icon from "@/components/Icon";
import { HURUF, huruf } from "@/lib/games/huruf";
import { preload, sayLetter, unlockAudio } from "@/lib/games/audio";
import { letterGeometry, useGeometry } from "@/lib/games/useGeometry";

/**
 * Trace & Say — the core game.
 *
 * One letter at a time: trace it, hear its NAME (Alif, Ba, Ta — the harakat
 * sounds are Harakah Lab's job), then move on. The letter's name rather than
 * its sound because that is the split the deck teaches and the answer the
 * ustazah gave: a bare letter is named, a letter with a harakah is sounded.
 *
 * Nothing is scored and nothing is saved. The rail marks what has been traced
 * this sitting so a teacher can see where they are, and that is all — a child
 * who traces Alif eleven times has not failed at anything.
 */
export default function TraceSay() {
  const { data: geometry, error } = useGeometry();
  const [level, setLevel] = useLevel();
  const [letterId, setLetterId] = useState(HURUF[0].id);
  const [doneIds, setDoneIds] = useState([]);
  const [beat, setBeat] = useState(0);

  const letter = huruf(letterId);
  const geo = letterGeometry(geometry, letterId);

  // Warm the next few letters' clips so a tap is never followed by a pause.
  useEffect(() => {
    const i = HURUF.findIndex((h) => h.id === letterId);
    preload(HURUF.slice(i, i + 4).map((h) => h.id));
  }, [letterId]);

  const onComplete = useCallback(() => {
    setDoneIds((d) => (d.includes(letterId) ? d : [...d, letterId]));
    setBeat((b) => b + 1);
    sayLetter({ letterId, arabic: letter.char });
  }, [letterId, letter]);

  function go(delta) {
    const i = HURUF.findIndex((h) => h.id === letterId);
    const next = HURUF[(i + delta + HURUF.length) % HURUF.length];
    setLetterId(next.id);
  }

  const complete = doneIds.includes(letterId);

  return (
    <GameShell
      title="Trace &amp; Say"
      subtitle={`${letter.name} — trace the glowing road, then hear it`}
      level={level}
      onLevelChange={setLevel}
    >
      <div className="flex h-full flex-col">
        <LetterRail selectedId={letterId} onSelect={setLetterId} done={doneIds} />

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2">
          {error ? (
            <p className="max-w-sm text-center text-[13px] text-charcoal-soft">
              The letter shapes could not be loaded. Check that
              <code className="mx-1 rounded bg-paper-deep px-1">public/huruf/geometry.json</code>
              is deployed.
            </p>
          ) : !geo ? (
            <p className="text-[13px] text-charcoal-soft">Loading the letters…</p>
          ) : (
            <TraceCanvas
              key={letterId}
              letter={letter}
              geometry={geo}
              level={level}
              onComplete={onComplete}
              className="aspect-square h-full max-h-full w-auto max-w-full"
            />
          )}

          <Mascot
            who="ustaz"
            mood={complete ? "cheer" : "idle"}
            beat={beat}
            className="absolute bottom-2 right-2 h-[16%] max-h-32 w-auto opacity-90 sm:h-[22%]"
          />
        </div>

        {/* The name, spoken and written. Tapping it repeats the sound — small
            children ask to hear things again, and again. */}
        <div className="flex flex-shrink-0 items-center gap-2 border-t border-line bg-white px-3 py-2">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous letter"
            className="flex h-11 w-11 items-center justify-center rounded-control text-charcoal-soft hover:bg-paper-deep"
          >
            <Icon name="chevron-right" size={20} />
          </button>

          <button
            type="button"
            onClick={() => {
              unlockAudio();
              sayLetter({ letterId, arabic: letter.char });
            }}
            className={`flex flex-1 items-center justify-center gap-2.5 rounded-control px-4 py-3 transition-colors ${
              complete ? "bg-gold-soft text-ink" : "bg-paper-deep text-charcoal"
            }`}
          >
            <Icon name="volume-2" size={20} />
            <span className="font-heading text-[22px] font-bold leading-none">{letter.name}</span>
            <span className="font-mirza text-[26px] leading-none">{letter.char}</span>
          </button>

          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next letter"
            className="flex h-11 w-11 items-center justify-center rounded-control text-charcoal-soft hover:bg-paper-deep"
          >
            <Icon name="chevron-left" size={20} />
          </button>
        </div>
      </div>
    </GameShell>
  );
}

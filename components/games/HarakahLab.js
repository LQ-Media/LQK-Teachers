"use client";

import { useEffect, useState } from "react";

import GameShell from "@/components/games/GameShell";
import Glyph from "@/components/games/Glyph";
import LetterRail from "@/components/games/LetterRail";
import Mascot from "@/components/games/Mascot";
import Icon from "@/components/Icon";
import { HARAKAT, HURUF, audioKey, huruf, sayFor, withHarakah } from "@/lib/games/huruf";
import { buzz, preload, sayLetter, unlockAudio } from "@/lib/games/audio";

/**
 * Harakah Lab — slide 2 of the deck, made live.
 *
 * The letter sits in the middle in its real Mirza shape. Three buttons below:
 * fatha, kasra, damma. Tap one and the mark appears on the letter, above or
 * below it as it should, with a glow landing where it arrived, and the sound
 * plays.
 *
 * The change is the teaching. On the printed card a child sees three finished
 * letters side by side and has to work out what differs; here one letter
 * changes under their own finger, so the mark and the change in sound arrive
 * together from the same tap. And because the mark lands above for fatha and
 * damma and below for kasra, where it goes is learned by watching.
 *
 * WHY THE MARK IS NOT DRAWN SEPARATELY
 *
 * The obvious build is a letter plus a floating harakah that flies in. It does
 * not work: a harakah is a combining character, and with no base letter to
 * attach to, the font has nowhere to put it — Mirza draws a lozenge and other
 * faces draw a dotted circle or nothing. So the letter is rendered twice, once
 * plain and once with its harakah, and the second is faded in over the first.
 * The bodies coincide exactly, so the only thing the eye sees change is the
 * mark arriving — and the font, not this component, decides where it sits.
 *
 * The transliteration shown is the deck's own — Qo, not Qa, for ق — so the
 * screen and the flashcard never disagree.
 */
/* Who is on screen. Used for the mascot AND for the default reciting voice,
   from one place so the chip in the header can never disagree with the face
   in the corner. */
const MASCOT = "ustazah";

export default function HarakahLab() {
  const [letterId, setLetterId] = useState(HURUF[1].id); // Ba: alif is a poor first demo
  const [picked, setPicked] = useState(null);
  const [beat, setBeat] = useState(0);

  const letter = huruf(letterId);

  /* The pick remembers which letter it was made on, so choosing a new letter
     clears the mark by making the old pick stale — rather than by an effect
     that resets state after the render has already gone out with it. */
  const harakah =
    picked?.letterId === letterId
      ? (HARAKAT.find((h) => h.id === picked.harakahId) ?? null)
      : null;

  useEffect(() => {
    preload(HARAKAT.map((h) => audioKey(letterId, h.id)));
  }, [letterId]);

  function pick(h) {
    unlockAudio();
    setPicked({ letterId, harakahId: h.id });
    setBeat((b) => b + 1);
    buzz(16);
    sayLetter({ letterId, harakahId: h.id, arabic: withHarakah(letter, h.id) });
  }

  return (
    <GameShell
      title="Harakah Lab"
      subtitle={`${letter.name} — tap a harakah and hear what it does`}
      mascot={MASCOT}
    >
      <div className="flex h-full flex-col">
        <LetterRail selectedId={letterId} onSelect={setLetterId} />

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <div className="relative h-full max-h-full">
            {/* The plain letter, always there and never moving. */}
            <Glyph size={62} className="h-full w-auto text-ink">
              {letter.char}
            </Glyph>

            {/* The same letter with its harakah, faded in on top. Keyed on the
                tap so each press replays the arrival. */}
            {harakah && (
              <div
                key={`${letterId}-${harakah.id}-${beat}`}
                className="lqk-harakah-land absolute inset-0"
              >
                <Glyph size={62} className="h-full w-auto text-ink">
                  {withHarakah(letter, harakah.id)}
                </Glyph>
              </div>
            )}
          </div>

          <Mascot
            who={MASCOT}
            mood={harakah ? "cheer" : "idle"}
            beat={beat}
            className="absolute bottom-0 right-2 h-[26%] max-h-28 w-auto opacity-90"
          />
        </div>

        {/* What it says, once a harakah is on. Big, because across a classroom
            the ustazah reads this out with the children. */}
        <div className="flex h-16 flex-shrink-0 items-center justify-center gap-3">
          {harakah ? (
            <button
              type="button"
              onClick={() => pick(harakah)}
              className="lqk-bloom flex items-center gap-3 rounded-pill bg-gold-soft px-5 py-2 text-ink"
            >
              <Icon name="volume-2" size={20} />
              <span className="font-heading text-[30px] font-bold leading-none">
                {sayFor(letter, harakah.id)}
              </span>
              <span dir="rtl" className="font-mirza text-[30px] leading-none">
                {withHarakah(letter, harakah.id)}
              </span>
            </button>
          ) : (
            <p className="text-[13px] text-charcoal-soft">Tap a harakah below</p>
          )}
        </div>

        {/* Right to left: fatha, kasra, damma in the deck's own card order. */}
        <div
          dir="rtl"
          className="grid flex-shrink-0 grid-cols-3 gap-2 border-t border-line bg-white p-3"
        >
          {HARAKAT.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => pick(h)}
              aria-pressed={harakah?.id === h.id}
              className={`flex flex-col items-center rounded-card border-2 py-2 transition-colors ${
                harakah?.id === h.id
                  ? "border-gold bg-gold-soft text-ink"
                  : "border-line bg-paper text-charcoal hover:bg-paper-deep"
              }`}
            >
              {/* U+25CC DOTTED CIRCLE stands in for "any letter", so the mark
                  is seen in the position it occupies rather than floating
                  alone — and, being a real base character, it gives the font
                  something to attach the mark to. */}
              <Glyph size={46} className="h-11 w-11">{`◌${h.mark}`}</Glyph>
              <span className="font-heading text-[13px] font-bold leading-tight">{h.name}</span>
              <span className="text-[11px] text-charcoal-soft">{sayFor(letter, h.id)}</span>
            </button>
          ))}
        </div>
      </div>
    </GameShell>
  );
}

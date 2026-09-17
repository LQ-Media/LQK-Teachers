"use client";

import { useCallback, useEffect, useState } from "react";

import GameShell from "@/components/games/GameShell";
import Glyph from "@/components/games/Glyph";
import LetterRail from "@/components/games/LetterRail";
import Mascot from "@/components/games/Mascot";
import Icon from "@/components/Icon";
import { HARAKAT, HURUF, audioKey, huruf, sayFor, withHarakah } from "@/lib/games/huruf";
import { buzz, preload, sayUnits, unlockAudio } from "@/lib/games/audio";

/**
 * Harakah Lab — all three harakat at once, and a strip you build with them.
 *
 * Pick a letter in the rail and its three forms appear together: بَ بِ بُ, in
 * the deck's own card order. Tap one and it sounds, and it joins the strip at
 * the bottom. Pick another letter, tap one of its forms, and that joins too —
 * so a child assembles بَتَ by choosing the pieces.
 *
 * THE STRIP IS SOUNDED OUT, NOT READ
 *
 * Tapping play says "Ba, Ta" — two separate sounds in order. It never says
 * "bat". This is the whole reason the game exists in this shape: a child who
 * is learning the marks needs to hear the pieces they picked, and a speech
 * engine handed the whole string would read it as a word and hide exactly the
 * thing being taught. See sayUnits in lib/games/audio.js for how the units are
 * kept apart.
 *
 * The strip's Arabic is shown as one run of text on purpose, so the browser
 * shapes it the way a mushaf would — بَتَ joined, not two loose letters. So the
 * eye gets the joined word and the ear gets the separate parts, which is the
 * step between knowing the letters and reading them.
 *
 * WHY THE LETTER IS NOT DRAWN WITH A FLOATING MARK
 *
 * A harakah is a combining character: with no base letter to attach to, the
 * font has nowhere to put it — Mirza draws a lozenge, other faces a dotted
 * circle or nothing. So each tile renders the real composed letter, and the
 * font decides where the mark sits. That is also why the picker below uses
 * U+25CC DOTTED CIRCLE as a stand-in base.
 *
 * The transliteration shown is the deck's own — Qo, not Qa, for ق — so the
 * screen and the flashcard never disagree.
 */
/* Who is on screen. Used for the mascot AND for the default reciting voice,
   from one place so the chip in the header can never disagree with the face
   in the corner. */
const MASCOT = "ustazah";

/* How many units the strip holds. Four is the longest the deck's own
   combination cards run to, and more than that stops fitting on a phone. */
const MAX_UNITS = 4;

export default function HarakahLab() {
  const [letterId, setLetterId] = useState(HURUF[1].id); // Ba: alif is a poor first demo
  const [units, setUnits] = useState([]);
  const [beat, setBeat] = useState(0);
  const [lit, setLit] = useState(null);

  const letter = huruf(letterId);

  useEffect(() => {
    preload(HARAKAT.map((h) => audioKey(letterId, h.id)));
  }, [letterId]);

  /** One form of the current letter: sound it, and add it to the strip. */
  const tap = useCallback(
    (h) => {
      unlockAudio();
      const unit = {
        letterId,
        harakahId: h.id,
        arabic: withHarakah(letter, h.id),
        say: sayFor(letter, h.id),
      };
      buzz(16);
      setLit(`${letterId}-${h.id}`);
      setBeat((b) => b + 1);
      // The tap says its own unit, on its own. Adding to the strip does not
      // replay the whole strip — that is what the play button is for.
      sayUnits([unit]);
      setUnits((prev) => (prev.length >= MAX_UNITS ? [...prev.slice(1), unit] : [...prev, unit]));
    },
    [letter, letterId],
  );

  const playStrip = useCallback(() => {
    unlockAudio();
    if (!units.length) return;
    setBeat((b) => b + 1);
    sayUnits(units);
  }, [units]);

  const playOne = useCallback((unit) => {
    unlockAudio();
    buzz(10);
    sayUnits([unit]);
  }, []);

  const joined = units.map((u) => u.arabic).join("");
  const said = units.map((u) => u.say).join(", ");

  return (
    <GameShell
      title="Harakah Lab"
      subtitle={
        units.length
          ? `${said} — tap play to hear them in order`
          : `${letter.name} — tap a harakah to hear it`
      }
      mascot={MASCOT}
    >
      <div className="flex h-full flex-col">
        <LetterRail selectedId={letterId} onSelect={setLetterId} />

        {/* The three forms of this letter, together. Right to left, in the
            deck's own card order: fatha, kasra, damma. */}
        <div
          dir="rtl"
          className="grid min-h-0 flex-1 grid-cols-3 gap-2 p-3"
          role="group"
          aria-label={`The three harakat on ${letter.name}`}
        >
          {HARAKAT.map((h) => {
            const key = `${letterId}-${h.id}`;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => tap(h)}
                aria-label={sayFor(letter, h.id)}
                className={`flex min-w-0 flex-col items-center justify-center rounded-card border-2 p-2 transition-colors ${
                  lit === key
                    ? "border-gold bg-gold-soft text-ink"
                    : "border-line bg-white text-charcoal hover:bg-paper-deep"
                }`}
              >
                <Glyph
                  size={58}
                  className={`min-h-0 w-full flex-1 ${lit === key ? "text-ink" : "text-charcoal"}`}
                >
                  {withHarakah(letter, h.id)}
                </Glyph>
                <span className="font-heading text-[22px] font-bold leading-none">
                  {sayFor(letter, h.id)}
                </span>
                <span className="mt-0.5 text-[11px] text-charcoal-soft">{h.name}</span>
              </button>
            );
          })}
        </div>

        {/* The strip: what has been built, and the play that sounds it out. */}
        <div className="relative flex-shrink-0 border-t border-line bg-white px-3 pb-[env(safe-area-inset-bottom)] pt-2">
          {units.length === 0 ? (
            <p className="flex h-20 items-center justify-center text-[13px] text-charcoal-soft">
              Tap the harakat above — they join here, and play one at a time
            </p>
          ) : (
            <div className="flex h-20 items-center gap-2">
              <button
                type="button"
                onClick={playStrip}
                aria-label={`Play ${said}`}
                className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-control bg-ink text-paper transition-colors hover:bg-ink-deep"
              >
                <Icon name="volume-2" size={24} />
              </button>

              {/* Each unit stays tappable on its own, because "say that one
                  again" is the most common thing asked of a strip. */}
              <div dir="rtl" className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
                {units.map((u, i) => (
                  <button
                    key={`${u.letterId}-${u.harakahId}-${i}`}
                    type="button"
                    onClick={() => playOne(u)}
                    aria-label={u.say}
                    className="flex min-w-0 flex-1 flex-col items-center rounded-control border border-line bg-paper py-1 transition-colors hover:bg-paper-deep"
                  >
                    <span dir="rtl" className="font-mirza text-[26px] leading-none text-ink">
                      {u.arabic}
                    </span>
                    <span className="font-heading text-[12px] font-bold text-charcoal">{u.say}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setUnits((p) => p.slice(0, -1))}
                  aria-label="Remove the last one"
                  className="flex h-6 w-10 items-center justify-center rounded-control text-charcoal-soft hover:bg-paper-deep"
                >
                  <Icon name="chevron-right" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setUnits([])}
                  aria-label="Clear"
                  className="flex h-6 w-10 items-center justify-center rounded-control text-[11px] font-bold text-charcoal-soft hover:bg-paper-deep"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            </div>
          )}

          {/* The joined word, shaped by the font the way a mushaf would set it,
              with what it is sounded out as underneath. */}
          {units.length > 1 && (
            <div className="flex items-baseline justify-center gap-3 pb-2">
              <span dir="rtl" className="font-mirza text-[34px] leading-none text-ink">
                {joined}
              </span>
              <span className="font-heading text-[15px] font-bold text-charcoal-soft">{said}</span>
            </div>
          )}

          <Mascot
            who={MASCOT}
            mood={units.length ? "cheer" : "idle"}
            beat={beat}
            className="pointer-events-none absolute bottom-1 right-2 h-16 w-auto opacity-90"
          />
        </div>
      </div>
    </GameShell>
  );
}

"use client";

import { useEffect, useRef } from "react";

import { HURUF } from "@/lib/games/huruf";

/**
 * The 28 letters as a scrolling rail, in deck order, for picking what to play.
 *
 * Right-to-left, because that is the order the alphabet runs and a child
 * learning to read Arabic should never be shown it left to right. The rail
 * keeps the chosen letter scrolled into view so a teacher tapping "next"
 * twenty-eight times never has to chase it.
 */
export default function LetterRail({ selectedId, onSelect, done = [] }) {
  const railRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div
      ref={railRef}
      dir="rtl"
      className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {HURUF.map((h) => {
        const active = h.id === selectedId;
        return (
          <button
            key={h.id}
            ref={active ? activeRef : null}
            type="button"
            onClick={() => onSelect(h.id)}
            aria-pressed={active}
            title={h.name}
            className={`flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-control border transition-colors ${
              active
                ? "border-gold bg-gold-soft text-ink"
                : done.includes(h.id)
                  ? "border-line bg-sand text-ink"
                  : "border-line bg-white text-charcoal hover:bg-paper-deep"
            }`}
          >
            <span className="font-mirza text-[24px] leading-none">{h.char}</span>
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide opacity-70">
              {h.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

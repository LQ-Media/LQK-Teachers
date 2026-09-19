"use client";

import Icon from "@/components/Icon";

// The tile row across the top of Shift Roster, laid out the way Sling lays it
// out — Karim's screenshot is the spec.
//
// Each tile is a white card with a circled outline icon, the COUNT in large
// type where there is one, and a small all-caps label under it. The active tile
// is tinted rather than merely bordered, because at this size a border alone is
// easy to miss.
//
// EVERY TILE OPENS SOMETHING REAL. Sling's row also has Groups, Tags and
// Announcements; LQK has nothing behind those, and a tile that opens an empty
// page is worse than no tile — it makes somebody wonder what they have failed
// to set up. Karim chose this explicitly on 17 Sep.
//
// The count is the point of the design: "71 EMPLOYEES" answers a question on
// the way past, which a plain text tab never does.

export default function SlingNav({ items, active, onSelect }) {
  return (
    <div
      role="tablist"
      aria-label="Shift roster sections"
      className="mb-6 flex gap-2 overflow-x-auto pb-1"
    >
      {items.map((it) => {
        const on = it.key === active;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(it.key)}
            title={it.hint || undefined}
            className={`flex min-w-[6.5rem] shrink-0 flex-col items-center gap-1.5 rounded-card border-[0.5px] px-3 py-3 transition-colors ${
              on
                ? "border-ink bg-ink/5 text-ink"
                : "border-line bg-white text-charcoal-soft hover:border-ink hover:text-charcoal"
            }`}
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] ${
                on ? "border-ink text-ink" : "border-line text-charcoal-soft"
              }`}
            >
              <Icon name={it.icon} size={17} />
            </span>

            {/* The count, where the section has one. Tiles without one keep an
                empty line of the same height so every label still lines up.
                An invisible "0" was the first attempt and it was wrong: opacity
                hides it from the eye but not from innerText, so a screen reader
                — and my own browser check — read "0 SCHEDULE". */}
            {it.count != null ? (
              <span className={`text-[15px] font-bold leading-none ${on ? "text-ink" : "text-charcoal"}`}>
                {it.count}
              </span>
            ) : (
              <span aria-hidden className="block h-[15px]" />
            )}

            <span className="text-center text-[10px] font-bold uppercase leading-tight tracking-wide">
              {it.label}
            </span>

            {/* A badge for the one thing on this screen that needs somebody to
                act — an unclocked shift, a session awaiting approval. */}
            {it.badge ? (
              <span className="rounded-pill bg-rust px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
                {it.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { groupIcon, sectionIcon } from "@/lib/dzikir/icons";

/**
 * The /dzikir landing browser. A plain client-side filter over the static
 * catalogue — at ~46 collections a substring match is instant and needs no
 * server round-trip. Each card links into the reader, which lazy-loads the
 * actual passages.
 *
 * The index card at the top carries one tile per main heading, showing what
 * that heading holds and jumping to its section below.
 */
export default function DzikirBrowser({ catalog }) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog
      .map((g) => ({
        ...g,
        sections: g.sections.filter(
          (s) =>
            s.title.toLowerCase().includes(needle) ||
            g.label.toLowerCase().includes(needle)
        ),
      }))
      .filter((g) => g.sections.length > 0);
  }, [catalog, q]);

  // Totals per heading for the index tiles.
  const index = useMemo(
    () =>
      catalog.map((g) => ({
        key: g.key,
        label: g.label,
        sections: g.sections.length,
        passages: g.sections.reduce((n, s) => n + s.count, 0),
      })),
    [catalog]
  );

  function jumpTo(key) {
    const el = document.getElementById(`dzikir-${key}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  return (
    <div>
      {/* Index — one tile per main heading */}
      <div className="mb-6 rounded-card border-[0.5px] border-line bg-white p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {index.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => jumpTo(g.key)}
              className="flex flex-col items-center gap-1.5 rounded-control border-[0.5px] border-line bg-paper px-2 py-3.5 text-center transition-[background-color,border-color,transform] duration-150 ease-out hover:border-gold hover:bg-gold-soft/30 active:scale-[0.97]"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-control bg-gold-soft text-ink">
                <Icon name={groupIcon(g.key)} size={22} />
              </span>
              <span className="text-[12.5px] font-bold leading-tight text-charcoal">{g.label}</span>
              <span className="text-[10.5px] leading-tight text-charcoal-soft">
                {g.sections} {g.sections === 1 ? "collection" : "collections"}
                <br />
                {g.passages.toLocaleString()} passages
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search collections…"
          className="w-full rounded-control border border-line bg-white px-3.5 py-2.5 text-[14px] text-charcoal outline-none placeholder:text-charcoal-soft/50 focus:border-gold"
        />
      </div>

      {groups.length === 0 ? (
        <p className="rounded-card border border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
          Nothing matches “{q}”.
        </p>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.key} id={`dzikir-${g.key}`} className="scroll-mt-4">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-sand/60 text-ink">
                  <Icon name={groupIcon(g.key)} size={16} />
                </span>
                <div className="min-w-0">
                  <h2 className="font-heading text-[17px] font-semibold text-charcoal">{g.label}</h2>
                  <p className="text-[12px] text-charcoal-soft">{g.blurb}</p>
                </div>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {g.sections.map((s) => (
                  <Link
                    key={s.key}
                    href={`/dzikir/${s.key}`}
                    className="group flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3 transition-colors hover:border-gold hover:bg-gold-soft/30"
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control bg-sand/60 text-ink">
                      <Icon name={sectionIcon(s.key)} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-charcoal">
                        {s.title}
                      </span>
                      <span className="block text-[11.5px] text-charcoal-soft">
                        {s.count.toLocaleString()} passage{s.count === 1 ? "" : "s"}
                        {s.subCount > 1 ? ` · ${s.subCount} sections` : ""}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-charcoal-soft/40 transition-transform group-hover:translate-x-0.5">
                      <Icon name="chevron-right" size={16} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

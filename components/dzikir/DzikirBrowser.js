"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";

// One distinct icon per top-level group, shared by the section headers and
// the floating jump rail so the mapping is learnable at a glance.
const GROUP_ICONS = {
  wirid: "sparkles",
  doa: "hand-heart",
  maulid: "flower",
  "haji-dan-umrah": "kaaba",
  spesial: "moon-star",
};

function iconFor(key) {
  return GROUP_ICONS[key] || "book-open";
}

/**
 * The /dzikir landing browser. A plain client-side filter over the static
 * catalogue — at ~46 collections a substring match is instant and needs no
 * server round-trip. Each card links into the reader, which lazy-loads the
 * actual passages.
 *
 * A floating rail (right edge on desktop, bottom dock on mobile) jumps to
 * each group's section on this page; a scroll listener keeps the rail's
 * active state in sync while reading.
 */
export default function DzikirBrowser({ catalog }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(catalog[0]?.key ?? null);

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

  // Scroll spy: the active group is the last one whose section top has passed
  // the reading line (~160px from the viewport top). rAF-throttled; five
  // getBoundingClientRect calls per frame is nothing.
  const rafRef = useRef(0);
  useEffect(() => {
    const update = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        let current = groups[0]?.key ?? null;
        for (const g of groups) {
          const el = document.getElementById(`dzikir-${g.key}`);
          if (el && el.getBoundingClientRect().top <= 160) current = g.key;
        }
        setActive(current);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      cancelAnimationFrame(rafRef.current);
    };
  }, [groups]);

  function jumpTo(key) {
    const el = document.getElementById(`dzikir-${key}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  return (
    <div>
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
            <section key={g.key} id={`dzikir-${g.key}`} className="scroll-mt-6">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-sand/60 text-ink">
                  <Icon name={iconFor(g.key)} size={16} />
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
                      <Icon name="book-open" size={16} />
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

      {/* Floating jump rail — vertical on the right edge for desktop, a
          bottom dock on smaller screens. Hidden while a search collapses the
          page to a single group. */}
      {groups.length > 1 && (
        <nav
          aria-label="Jump to a collection"
          className="fixed z-40 flex gap-1.5 rounded-2xl border-[0.5px] border-line bg-white/90 p-1.5 shadow-[0_8px_30px_rgba(38,34,27,0.14)] backdrop-blur-md max-lg:bottom-5 max-lg:left-1/2 max-lg:-translate-x-1/2 max-lg:flex-row lg:right-5 lg:top-1/2 lg:-translate-y-1/2 lg:flex-col"
        >
          {groups.map((g) => {
            const isActive = active === g.key;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => jumpTo(g.key)}
                aria-label={`Jump to ${g.label}`}
                aria-current={isActive ? "true" : undefined}
                title={g.label}
                className={`group/rail relative flex h-11 w-11 items-center justify-center rounded-control transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.96] ${
                  isActive
                    ? "bg-gold text-ink shadow-[0_4px_12px_rgba(224,169,59,0.35)]"
                    : "text-charcoal-soft hover:bg-paper-deep hover:text-charcoal"
                }`}
              >
                <Icon name={iconFor(g.key)} size={20} />
                {/* Hover label — desktop only; the dock relies on the icons */}
                <span className="pointer-events-none absolute right-full top-1/2 mr-2.5 hidden -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-control bg-ink px-2.5 py-1.5 text-[11px] font-semibold text-paper opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/rail:translate-x-0 group-hover/rail:opacity-100 lg:block">
                  {g.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { groupIcon, groupImage, sectionIcon } from "@/lib/dzikir/icons";
import { CardGrid, NavCard } from "@/components/dzikir/CardGrid";

/**
 * The /dzikir landing screen: the six main headings and nothing else.
 *
 * It is a launcher, not an index — tapping a heading opens that group's own
 * page, which lists its collections. Six tiles fit one row from `lg` up and
 * two balanced rows of three below it, which is why the grid steps 3 → 6 with
 * nothing in between: a four-column phone layout would leave a 3+3 set as
 * 4+2, and the point of the screen is that it reads as an even block.
 *
 * Search is the one thing that breaks the launcher: typing swaps the tiles for
 * matching collections across every group, so a teacher who knows the name of
 * what they want does not have to remember which heading it lives under.
 */
export default function DzikirBrowser({ catalog }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const groups = useMemo(
    () =>
      catalog.map((g) => ({
        key: g.key,
        label: g.label,
        sections: g.sections.length,
        passages: g.sections.reduce((n, s) => n + s.count, 0),
      })),
    [catalog]
  );

  // Flat across all groups — search answers "where is this collection", so
  // scoping it to one heading would defeat the purpose.
  const matches = useMemo(() => {
    if (!needle) return [];
    const out = [];
    for (const g of catalog) {
      for (const s of g.sections) {
        if (s.title.toLowerCase().includes(needle) || g.label.toLowerCase().includes(needle)) {
          out.push({ ...s, groupLabel: g.label });
        }
      }
    }
    return out;
  }, [catalog, needle]);

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

      {needle ? (
        matches.length === 0 ? (
          <p className="rounded-card border border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
            Nothing matches “{q}”.
          </p>
        ) : (
          <>
            <p className="mb-2.5 text-[12px] text-charcoal-soft">
              {matches.length} collection{matches.length === 1 ? "" : "s"} matching “{q}”
            </p>
            <CardGrid>
              {matches.map((s) => (
                <NavCard
                  key={s.key}
                  href={`/dzikir/${s.group}/${s.slug}`}
                  icon={sectionIcon(s.key)}
                  title={s.title}
                  meta={`${s.groupLabel} · ${s.count.toLocaleString()} passage${s.count === 1 ? "" : "s"}`}
                />
              ))}
            </CardGrid>
          </>
        )
      ) : (
        <div className="grid grid-cols-3 gap-2.5 [grid-auto-rows:1fr] lg:grid-cols-6">
          {groups.map((g) => (
            <Link
              key={g.key}
              href={`/dzikir/${g.key}`}
              className="flex h-full flex-col items-center gap-1.5 rounded-card border-[0.5px] border-line bg-white px-2 py-4 text-center transition-[background-color,border-color,transform] duration-150 ease-out hover:border-gold hover:bg-gold-soft/30 active:scale-[0.97]"
            >
              {groupImage(g.key) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={groupImage(g.key)}
                  alt=""
                  width={64}
                  height={64}
                  className="h-12 w-12 rounded-control bg-gold-soft/50 object-contain p-1 sm:h-16 sm:w-16"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-control bg-gold-soft text-ink sm:h-16 sm:w-16">
                  <Icon name={groupIcon(g.key)} size={26} />
                </span>
              )}
              <span className="block break-words text-[12.5px] font-bold leading-tight text-charcoal sm:text-[13.5px]">
                {g.label}
              </span>
              <span className="mt-auto block text-[10.5px] leading-tight text-charcoal-soft">
                {g.sections} {g.sections === 1 ? "collection" : "collections"}
                <br />
                {g.passages.toLocaleString()} passages
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

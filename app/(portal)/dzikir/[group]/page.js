import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { CATALOG } from "@/lib/dzikir/catalog";
import { groupImage, sectionIcon } from "@/lib/dzikir/icons";
import DzikirCrumbs from "@/components/dzikir/DzikirCrumbs";
import { CardGrid, NavCard } from "@/components/dzikir/CardGrid";

export async function generateMetadata({ params }) {
  const { group } = await params;
  const g = CATALOG.find((x) => x.key === group);
  return { title: g ? `${g.label} · Wirid & Doa` : "Wirid & Doa" };
}

/**
 * One heading of the library — its collections, as cards and nothing else.
 *
 * This level ships no Arabic at all: CATALOG carries titles and counts only,
 * so opening a heading with 33 collections costs a few hundred bytes. The
 * passages arrive one collection deeper (see [slug]/page.js).
 */
export default async function DzikirGroupPage({ params }) {
  await requireSession();
  const { group } = await params;

  const g = CATALOG.find((x) => x.key === group);
  if (!g) notFound();

  const passages = g.sections.reduce((n, s) => n + s.count, 0);
  const art = groupImage(g.key);

  return (
    <div className="max-w-3xl px-4 py-6 sm:p-8">
      <DzikirCrumbs items={[{ label: "Wirid & Doa", href: "/dzikir" }, { label: g.label }]} />

      <div className="mb-6 flex items-start gap-3.5">
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 flex-none rounded-control bg-gold-soft/50 object-contain p-1"
          />
        ) : null}
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold text-charcoal">{g.label}</h1>
          <p className="mt-1 text-[13px] text-charcoal-soft">{g.blurb}</p>
          <p className="mt-1 text-[12px] text-charcoal-soft/70">
            {g.sections.length} collection{g.sections.length === 1 ? "" : "s"} ·{" "}
            {passages.toLocaleString()} passages
          </p>
        </div>
      </div>

      <CardGrid>
        {g.sections.map((s) => (
          <NavCard
            key={s.key}
            href={`/dzikir/${s.group}/${s.slug}`}
            icon={sectionIcon(s.key)}
            title={s.title}
            meta={`${s.count.toLocaleString()} passage${s.count === 1 ? "" : "s"}${
              s.subCount > 1 ? ` · ${s.subCount} sections` : ""
            }`}
          />
        ))}
      </CardGrid>
    </div>
  );
}

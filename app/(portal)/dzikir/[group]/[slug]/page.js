import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { LOADERS } from "@/lib/dzikir/loaders";
import { SECTION_INDEX } from "@/lib/dzikir/catalog";
import { subIcon } from "@/lib/dzikir/icons";
import { subsectionsOf, subTitle } from "@/lib/dzikir/subsections";
import DzikirCrumbs from "@/components/dzikir/DzikirCrumbs";
import { CardGrid, NavCard } from "@/components/dzikir/CardGrid";

export async function generateMetadata({ params }) {
  const { group, slug } = await params;
  const meta = SECTION_INDEX[`${group}/${slug}`];
  return { title: meta ? meta.title : "Wirid & Doa" };
}

/**
 * One collection — its sub-sections as cards.
 *
 * The passage JSON is loaded here (it is the only place the sub-section names
 * live), but only titles and counts cross to the client: a card list for
 * Dala'il al-Khayrat is 13 rows, not its 708 passages. The passages themselves
 * are sent one sub-section at a time by [sub]/page.js.
 *
 * A collection with no sub-headings still gets this screen, showing its single
 * "Opening" card. Skipping it would make the trail's depth vary by collection,
 * and the breadcrumb is only trustworthy if every level is always there.
 */
export default async function DzikirSectionPage({ params }) {
  await requireSession();
  const { group, slug } = await params;
  const key = `${group}/${slug}`;

  const load = LOADERS[key];
  const meta = SECTION_INDEX[key];
  if (!load || !meta) notFound();

  const mod = await load();
  const section = mod.default ?? mod;
  const subs = subsectionsOf(section.passages);

  return (
    <div className="max-w-3xl px-4 py-6 sm:p-8">
      <DzikirCrumbs
        items={[
          { label: "Wirid & Doa", href: "/dzikir" },
          { label: meta.groupLabel, href: `/dzikir/${group}` },
          { label: section.title },
        ]}
      />

      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">{section.title}</h1>
        <p className="mt-1 text-[13px] text-charcoal-soft">
          {subs.length} section{subs.length === 1 ? "" : "s"} ·{" "}
          {section.count.toLocaleString()} passage{section.count === 1 ? "" : "s"}
        </p>
      </div>

      <CardGrid>
        {subs.map((s, i) => (
          <NavCard
            key={i}
            href={`/dzikir/${group}/${slug}/${i}`}
            icon={subIcon(i)}
            title={subTitle(s.sub, i)}
            meta={`${s.pages.length.toLocaleString()} passage${s.pages.length === 1 ? "" : "s"}`}
          />
        ))}
      </CardGrid>
    </div>
  );
}

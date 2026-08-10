import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { LOADERS } from "@/lib/dzikir/loaders";
import { SECTION_INDEX } from "@/lib/dzikir/catalog";
import { naskh } from "@/lib/dzikir/font";
import { subsectionsOf, subTitle } from "@/lib/dzikir/subsections";
import DzikirCrumbs from "@/components/dzikir/DzikirCrumbs";
import DzikirReader from "@/components/dzikir/DzikirReader";

export async function generateMetadata({ params }) {
  const { group, slug, sub } = await params;
  const meta = SECTION_INDEX[`${group}/${slug}`];
  if (!meta) return { title: "Wirid & Doa" };
  const mod = await LOADERS[`${group}/${slug}`]?.();
  const subs = subsectionsOf((mod?.default ?? mod)?.passages);
  const s = subs[Number(sub)];
  return { title: s ? `${subTitle(s.sub, Number(sub))} · ${meta.title}` : meta.title };
}

/**
 * One sub-section, read a single passage at a time.
 *
 * The whole sub-section is sent to the client even though only one passage is
 * on screen: swiping has to be instant, and a route per passage would mean a
 * server round-trip per page turn. A sub-section is a few dozen passages, not
 * the 708 of a whole collection, so the payload stays small — which is exactly
 * why the library splits at this level rather than at the collection.
 */
export default async function DzikirPassagePage({ params }) {
  await requireSession();
  const { group, slug, sub } = await params;
  const key = `${group}/${slug}`;

  const load = LOADERS[key];
  const meta = SECTION_INDEX[key];
  if (!load || !meta) notFound();

  const mod = await load();
  const section = mod.default ?? mod;
  const subs = subsectionsOf(section.passages);

  const index = Number(sub);
  if (!Number.isInteger(index) || index < 0 || index >= subs.length) notFound();
  const current = subs[index];
  const title = subTitle(current.sub, index);

  return (
    <div className={`${naskh.variable} max-w-3xl px-4 py-6 sm:p-8`}>
      <DzikirCrumbs
        items={[
          { label: "Wirid & Doa", href: "/dzikir" },
          { label: meta.groupLabel, href: `/dzikir/${group}` },
          { label: section.title, href: `/dzikir/${group}/${slug}` },
          { label: title },
        ]}
      />

      <div className="mb-4">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-gold">
          {section.title}
        </p>
        <h1 className="font-heading text-xl font-semibold text-charcoal">{title}</h1>
      </div>

      <DzikirReader
        pages={current.pages}
        title={title}
        prev={
          index > 0
            ? { href: `/dzikir/${group}/${slug}/${index - 1}`, title: subTitle(subs[index - 1].sub, index - 1) }
            : null
        }
        next={
          index < subs.length - 1
            ? { href: `/dzikir/${group}/${slug}/${index + 1}`, title: subTitle(subs[index + 1].sub, index + 1) }
            : null
        }
        upHref={`/dzikir/${group}/${slug}`}
      />
    </div>
  );
}

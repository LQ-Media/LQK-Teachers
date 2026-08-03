import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { LOADERS } from "@/lib/dzikir/loaders";
import { SECTION_INDEX } from "@/lib/dzikir/catalog";
import { neighboursOf } from "@/lib/dzikir/nav";
import { naskh } from "@/lib/dzikir/font";
import Icon from "@/components/Icon";
import DzikirReader from "@/components/dzikir/DzikirReader";

export async function generateMetadata({ params }) {
  const { group, slug } = await params;
  const meta = SECTION_INDEX[`${group}/${slug}`];
  return { title: meta ? meta.title : "Wirid & Doa" };
}

/**
 * One devotional collection. The passages are code-split per collection and
 * loaded here on the server, so the client only ever receives the one the
 * teacher opened — never all ~4,100 at once.
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
  const nav = neighboursOf(key);

  return (
    <div className={`${naskh.variable} px-4 py-6 sm:p-8 max-w-3xl`}>
      <Link
        href="/dzikir"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-charcoal-soft transition-colors hover:text-charcoal"
      >
        <Icon name="arrow-left" size={15} />
        Wirid &amp; Doa
      </Link>

      <div className="mb-5">
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-gold">
          {meta.groupLabel}
        </p>
        <h1 className="font-heading text-2xl font-semibold text-charcoal">{section.title}</h1>
        <p className="mt-1 text-[13px] text-charcoal-soft">
          {section.count.toLocaleString()} passage{section.count === 1 ? "" : "s"}
          <span className="text-charcoal-soft/60">
            {" · "}
            {nav.position} of {nav.total}
          </span>
        </p>
      </div>

      <DzikirReader passages={section.passages} prev={nav.prev} next={nav.next} />
    </div>
  );
}

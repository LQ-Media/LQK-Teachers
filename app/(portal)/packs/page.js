import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { aiCapabilities } from "@/lib/ai/provider";
import { ageLabel } from "@/lib/notes/taxonomy";
import { ALL_SURAHS } from "@/lib/quran/surah-list";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import PackBuilder from "@/components/packs/PackBuilder";

export const metadata = { title: "Lesson Packs" };

export default async function PacksPage() {
  const session = await requireSession();
  const canReview = session.role === "reviewer" || session.role === "admin";
  const db = getDb();

  // Teachers only ever see approved packs; reviewers also see their drafts.
  const rows = db
    .prepare(
      `SELECT id, label, age_group, status, tajweed, surah, from_ayah
       FROM lesson_packs
       ${canReview ? "" : "WHERE status = 'approved'"}
       ORDER BY surah ASC, from_ayah ASC`
    )
    .all();

  const packs = rows.map((p) => ({
    id: p.id,
    label: p.label,
    ageGroup: p.age_group,
    status: p.status,
    ruleCount: countRules(p.tajweed),
  }));

  const approved = packs.filter((p) => p.status === "approved");
  const drafts = packs.filter((p) => p.status === "draft");

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <PageHeading
          icon="clipboard-check"
          title="Lesson Packs"
          subtitle="A ready 30-minute plan for any portion — the same plan for every teacher covering the same ayat. Built once, reviewed once, then free to use forever."
        />
      </div>

      {canReview && (
        <PackBuilder
          surahs={ALL_SURAHS.map((s) => ({ number: s.number, name: s.name, ayahCount: s.ayahCount }))}
          canGenerate={aiCapabilities().summarise}
        />
      )}

      {canReview && drafts.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-heading text-[17px] font-bold text-charcoal">
            Awaiting your review
            <span className="ml-2 text-[13px] font-normal text-charcoal-soft">{drafts.length}</span>
          </h2>
          <ul className="space-y-2">
            {drafts.map((p) => (
              <PackRow key={p.id} pack={p} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 font-heading text-[17px] font-bold text-charcoal">
          Ready to teach
          {approved.length > 0 && (
            <span className="ml-2 text-[13px] font-normal text-charcoal-soft">{approved.length}</span>
          )}
        </h2>
        {approved.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-white/60 px-5 py-10 text-center text-[13px] text-charcoal-soft">
            {canReview
              ? "No approved packs yet. Build one above, check it, then approve it."
              : "No packs have been published yet. Your reviewer builds these."}
          </p>
        ) : (
          <ul className="space-y-2">
            {approved.map((p) => (
              <PackRow key={p.id} pack={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PackRow({ pack }) {
  return (
    <li>
      <Link
        href={`/packs/${pack.id}`}
        className="flex items-center gap-3 rounded-card border border-line bg-white px-5 py-4 transition-colors hover:border-gold hover:bg-paper"
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-gold-soft text-ink">
          <Icon name="clipboard-check" size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-heading text-[15px] font-bold text-charcoal">{pack.label}</span>
          <span className="mt-0.5 block text-[12px] text-charcoal-soft">
            {ageLabel(pack.ageGroup)}
            {pack.ruleCount > 0 && ` · ${pack.ruleCount} tajweed rule${pack.ruleCount === 1 ? "" : "s"}`}
          </span>
        </span>
        {pack.status === "draft" && (
          <span className="flex-shrink-0 rounded-pill bg-rust-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8A4030]">
            Draft
          </span>
        )}
        <span className="flex-shrink-0 text-charcoal-soft">
          <Icon name="chevron-right" size={16} />
        </span>
      </Link>
    </li>
  );
}

function countRules(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

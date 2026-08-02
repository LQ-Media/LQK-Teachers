import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { normaliseSummary } from "@/lib/ai/provider";
import { ageLabel } from "@/lib/notes/taxonomy";
import Icon from "@/components/Icon";
import NoteSummary from "@/components/notebook/NoteSummary";

/**
 * A note as the rest of the centre sees it.
 *
 * This query deliberately does NOT select raw_text. Publishing a summary of a
 * talk is one thing; redistributing a verbatim transcript of an ustaz's
 * lecture is another, and it isn't ours to do. The contributor keeps their
 * transcript on their own /notebook page.
 */
export default async function SharedNotePage({ params }) {
  const { id } = await params;
  const session = await requireSession();
  const db = getDb();

  const row = db
    .prepare(
      `SELECT n.id, n.title, n.topic, n.age_group, n.speaker, n.venue, n.occurred_on,
              n.shared_at, n.summary, n.teacher_id, p.full_name AS contributor
       FROM notes n JOIN profiles p ON p.id = n.teacher_id
       WHERE n.id = ? AND n.shared_at IS NOT NULL`
    )
    .get(id);

  if (!row) notFound();

  let summary = null;
  try {
    summary = normaliseSummary(JSON.parse(row.summary));
  } catch {
    notFound(); // a shared note with no readable summary has nothing to show
  }

  const isOwn = row.teacher_id === session.userId;

  return (
    <div className="p-8 max-w-3xl">
      <Link
        href="/ilmu"
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-charcoal-soft transition-colors hover:text-charcoal"
      >
        <Icon name="arrow-left" size={15} />
        Ilmu Bank
      </Link>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {row.topic && (
          <span className="rounded-pill bg-gold-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink">
            {row.topic}
          </span>
        )}
        {row.age_group && row.age_group !== "all" && (
          <span className="rounded-pill bg-paper-deep px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft">
            {ageLabel(row.age_group)}
          </span>
        )}
      </div>

      <h1 className="font-heading text-2xl font-semibold leading-tight text-charcoal">{row.title}</h1>

      <div className="mt-3 rounded-control bg-paper-deep/60 px-4 py-3 text-[13px] text-charcoal-soft">
        Shared by <span className="font-semibold text-charcoal">{row.contributor}</span>
        {row.speaker && (
          <>
            {" "}
            · from a talk by <span className="font-semibold text-charcoal">{row.speaker}</span>
          </>
        )}
        {row.venue ? ` at ${row.venue}` : ""}
        {row.occurred_on ? ` · ${row.occurred_on}` : ""}
      </div>

      <div className="mt-7">
        <NoteSummary summary={summary} />
      </div>

      <p className="mt-6 text-[12px] leading-relaxed text-charcoal-soft">
        These are a colleague&apos;s personal study notes, written up automatically. They are not a record
        of what the speaker said and carry no religious authority — verify anything before you teach it.
      </p>

      {isOwn && (
        <Link
          href={`/notebook/${row.id}`}
          className="mt-6 inline-flex items-center gap-2 rounded-control bg-white px-4 py-2 text-[13px] font-semibold text-charcoal ring-1 ring-line transition-colors hover:bg-paper-deep"
        >
          <Icon name="pencil" size={15} />
          This is yours — open in your Notebook
        </Link>
      )}
    </div>
  );
}

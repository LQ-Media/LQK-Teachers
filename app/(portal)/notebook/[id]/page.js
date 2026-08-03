import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { aiCapabilities, normaliseSummary } from "@/lib/ai/provider";
import Icon from "@/components/Icon";
import NoteSummary from "@/components/notebook/NoteSummary";
import NoteActions from "@/components/notebook/NoteActions";
import ShareControl from "@/components/notebook/ShareControl";

const SOURCE_LABEL = {
  recording: "From a recording",
  photo: "From a photo",
  typed: "Typed",
};

export default async function NotePage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  const db = getDb();

  const row = db.prepare("SELECT * FROM notes WHERE id = ? AND teacher_id = ?").get(id, session.userId);
  if (!row) notFound();

  let summary = null;
  if (row.summary) {
    try {
      summary = normaliseSummary(JSON.parse(row.summary));
    } catch {
      summary = null; // corrupt blob — fall back to showing the raw text only
    }
  }

  const capabilities = aiCapabilities();
  const meta = [SOURCE_LABEL[row.source], row.occurred_on, row.speaker, row.venue].filter(Boolean);

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl">
      <Link
        href="/notebook"
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-charcoal-soft transition-colors hover:text-charcoal"
      >
        <Icon name="arrow-left" size={15} />
        Notebook
      </Link>

      {sp?.warn && (
        <div className="mb-5 flex items-start gap-2.5 rounded-control bg-gold-soft px-4 py-3 text-[13px] text-ink">
          <span className="mt-0.5 flex-shrink-0">
            <Icon name="alert-triangle" size={16} />
          </span>
          <p>
            Your note was saved, but the summary couldn&apos;t be generated. The full text is safe below —
            try summarising again whenever you like.
          </p>
        </div>
      )}

      <h1 className="font-heading text-2xl font-semibold leading-tight text-charcoal">{row.title}</h1>
      {meta.length > 0 && <p className="mt-1.5 text-[13px] text-charcoal-soft">{meta.join(" · ")}</p>}

      {summary ? (
        <div className="mt-7 space-y-6">
          <NoteSummary summary={summary} />
          <p className="text-[12px] leading-relaxed text-charcoal-soft">
            These are your own study notes, written up automatically from the text below. They are not a
            record of what the speaker said, and they carry no religious authority — verify anything you
            intend to pass on.
          </p>
        </div>
      ) : (
        <div className="mt-7 rounded-card border border-dashed border-line bg-white/60 px-5 py-6 text-center">
          <p className="text-[13px] text-charcoal-soft">
            {capabilities.summarise
              ? "This note hasn't been summarised yet."
              : "Summarising isn't switched on for this server, so this note is stored as written."}
          </p>
        </div>
      )}

      {/* The transcript is the owner's alone — it is never published to the
          Ilmu Bank, and never rendered on /ilmu/[id]. */}
      <details className="mt-7 rounded-card border border-line bg-white">
        <summary className="cursor-pointer list-none px-5 py-4 font-heading text-[14px] font-bold text-charcoal">
          <span className="flex items-center justify-between gap-2">
            {row.source === "recording" ? "Full transcript" : "Original text"}
            <Icon name="chevrons-down" size={16} />
          </span>
        </summary>
        <p className="whitespace-pre-wrap border-t border-line px-5 py-4 text-[13px] leading-relaxed text-charcoal-soft">
          {row.raw_text}
        </p>
      </details>

      <ShareControl
        id={row.id}
        sharedAt={row.shared_at}
        topic={row.topic}
        ageGroup={row.age_group}
        canShare={Boolean(summary)}
        needsSpeaker={row.source === "recording" && !row.speaker}
      />

      <NoteActions id={row.id} canSummarise={capabilities.summarise} hasSummary={Boolean(summary)} />
    </div>
  );
}

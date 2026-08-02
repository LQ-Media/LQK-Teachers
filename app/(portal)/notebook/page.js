import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { aiCapabilities } from "@/lib/ai/provider";
import { sgToday } from "@/lib/actions/notes";
import Icon from "@/components/Icon";
import NotebookApp from "@/components/notebook/NotebookApp";

const SOURCE_ICON = { recording: "mic", photo: "camera", typed: "type" };

export default async function NotebookPage() {
  const session = await requireSession();
  const db = getDb();

  // node:sqlite rows have a null prototype; map to plain objects before passing
  // any of them to a Client Component.
  const notes = db
    .prepare(
      `SELECT id, title, source, speaker, venue, occurred_on, summary, created_at
       FROM notes WHERE teacher_id = ? ORDER BY occurred_on DESC, created_at DESC`
    )
    .all(session.userId)
    .map((n) => ({
      id: n.id,
      title: n.title,
      source: n.source,
      speaker: n.speaker,
      venue: n.venue,
      occurred_on: n.occurred_on,
      summarised: Boolean(n.summary),
      created_at: n.created_at,
    }));

  const capabilities = aiCapabilities();

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">Halaqah Notebook</h1>
        <p className="text-[13px] text-charcoal-soft mt-1">
          Capture a kuliah, a page from a kitab, or your own notes — and get them back as tidy key
          points, references and class ideas.
        </p>
      </div>

      <NotebookApp capabilities={capabilities} today={sgToday()} />

      <div className="mt-10">
        <h2 className="font-heading text-[17px] font-bold text-charcoal">
          Your notes
          {notes.length > 0 && (
            <span className="ml-2 text-[13px] font-normal text-charcoal-soft">{notes.length}</span>
          )}
        </h2>

        {notes.length === 0 ? (
          <p className="mt-3 rounded-card border border-dashed border-line bg-white/60 px-5 py-8 text-center text-[13px] text-charcoal-soft">
            Nothing saved yet. Your first note will appear here.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/notebook/${note.id}`}
                  className="flex items-start gap-3 rounded-card border border-line bg-white px-5 py-4 transition-colors hover:border-gold hover:bg-paper"
                >
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control bg-gold-soft text-ink">
                    <Icon name={SOURCE_ICON[note.source] || "notebook"} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-heading text-[15px] font-bold text-charcoal">
                      {note.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-charcoal-soft">
                      {[note.occurred_on, note.speaker, note.venue].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {!note.summarised && (
                    <span className="mt-1 flex-shrink-0 rounded-pill bg-paper-deep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-soft">
                      Raw
                    </span>
                  )}
                  <span className="mt-1 flex-shrink-0 text-charcoal-soft">
                    <Icon name="chevron-right" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

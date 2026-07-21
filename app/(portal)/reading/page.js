import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/date";
import ReadingLogForm from "@/components/ReadingLogForm";

export default async function ReadingPage() {
  const session = await requireSession();
  const db = getDb();
  const entries = db
    .prepare("SELECT * FROM reading_entries WHERE teacher_id = ? ORDER BY created_at DESC")
    .all(session.userId);

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">My reading</h1>
        <p className="text-[13px] text-charcoal-soft mt-1">
          Self-logged reading practice — saved immediately, no approval needed.
        </p>
      </div>

      <div className="mb-6">
        <ReadingLogForm />
      </div>

      <div className="bg-white border-[0.5px] border-line rounded-card p-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft mb-2">
          History
        </div>
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between py-2.5 border-b-[0.5px] border-line last:border-0">
              <div className="text-[13px] font-medium text-charcoal">
                {entry.entry_type === "surah" ? `Completed ${entry.surah_name}` : `Reading session · ${entry.session_minutes} minutes`}
              </div>
              <div className="text-[11px] text-charcoal-soft">{formatDate(entry.created_at)}</div>
            </li>
          ))}
          {entries.length === 0 && (
            <li className="py-4 text-[13px] text-charcoal-soft">No reading entries yet — log one above.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

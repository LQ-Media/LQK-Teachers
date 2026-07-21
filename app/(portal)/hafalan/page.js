import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/date";
import StatusPill from "@/components/StatusPill";
import HafalanLogForm from "@/components/HafalanLogForm";

export default async function HafalanPage({ searchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const resubmitSurah = sp?.resubmit ? Number(sp.resubmit) : undefined;

  const db = getDb();
  const entries = db
    .prepare("SELECT * FROM hafalan_entries WHERE teacher_id = ? ORDER BY created_at DESC")
    .all(session.userId);

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">My hafalan</h1>
        <p className="text-[13px] text-charcoal-soft mt-1">
          Your own Quran memorisation progress — not related to students.
        </p>
      </div>

      <div className="mb-6">
        <HafalanLogForm defaultSurah={resubmitSurah} defaultOpen={Boolean(resubmitSurah)} />
      </div>

      <div className="bg-white border-[0.5px] border-line rounded-card p-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft mb-2">
          Entries
        </div>
        <ul>
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={`py-3 border-b-[0.5px] border-line last:border-0 ${entry.status === "pending" ? "opacity-85" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-medium text-charcoal">{entry.surah_name}</div>
                  {entry.note && <div className="text-[12px] text-charcoal-soft mt-0.5">{entry.note}</div>}
                  <div className="text-[11px] text-charcoal-soft mt-0.5">{formatDate(entry.created_at)}</div>
                </div>
                <StatusPill
                  status={entry.status === "pending" ? "pending" : entry.status === "approved" ? "mutqin" : "needs_review"}
                  label={entry.status === "pending" ? "Awaiting review" : entry.status === "approved" ? "Approved" : "Rejected"}
                />
              </div>

              {entry.status === "rejected" && (
                <div className="mt-3 bg-rust-soft rounded-control p-3">
                  <div className="text-[11px] font-bold text-[#8A4030] mb-1">Reviewer's note</div>
                  <div className="text-[12px] text-[#8A4030] mb-2">{entry.reviewer_note}</div>
                  <Link
                    href={`/hafalan?resubmit=${entry.surah_number}`}
                    className="inline-block text-[12px] font-semibold text-ink hover:text-ink-deep"
                  >
                    Resubmit →
                  </Link>
                </div>
              )}
            </li>
          ))}
          {entries.length === 0 && (
            <li className="py-4 text-[13px] text-charcoal-soft">
              No hafalan entries yet — log your first surah above.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

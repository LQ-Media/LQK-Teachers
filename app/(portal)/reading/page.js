import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/date";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import ReadingLogForm from "@/components/ReadingLogForm";
import ReadingHistory from "@/components/ReadingHistory";

export default async function ReadingPage() {
  const session = await requireSession();
  const db = getDb();
  // node:sqlite rows have a null prototype; map to plain objects before passing
  // any of them to a Client Component (ReadingHistory).
  const entries = db
    .prepare(
      "SELECT * FROM reading_entries WHERE teacher_id = ? ORDER BY COALESCE(read_at, created_at) DESC, created_at DESC"
    )
    .all(session.userId)
    .map((e) => ({
      id: e.id,
      entry_type: e.entry_type,
      surah_number: e.surah_number,
      surah_name: e.surah_name,
      session_minutes: e.session_minutes,
      verse_key: e.verse_key,
      created_at: e.created_at,
      read_at: e.read_at,
    }));

  const lastRead = entries.find((e) => e.entry_type === "surah") || null;
  const lastAyah = lastRead?.verse_key ? lastRead.verse_key.split(":")[1] : null;

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <PageHeading
          route="/reading"
          icon="notebook"
          title="My reading"
          subtitle="Self-logged reading practice — saved immediately, no approval needed."
        />
      </div>

      {/* Last read — connected to the Quran reader */}
      <div className="mb-6 rounded-card border-[0.5px] border-line bg-gradient-to-br from-white to-[#FDF3F7] p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-gold">
            <Icon name="bookmark" size={16} filled />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">Last read</span>
        </div>
        {lastRead ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="font-heading text-[20px] font-semibold text-charcoal">
                {lastRead.surah_name}
                {lastAyah ? <span className="text-charcoal-soft font-normal"> · Ayah {lastAyah}</span> : null}
              </div>
              <div className="text-[12px] text-charcoal-soft mt-0.5">
                {formatDateTime(lastRead.read_at || lastRead.created_at)}
              </div>
            </div>
            <Link
              href="/quran"
              className="flex items-center gap-1.5 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep"
            >
              <Icon name="book-open" size={15} />
              Open in reader
            </Link>
          </div>
        ) : (
          <p className="text-[13px] text-charcoal-soft">
            Nothing yet. Log where you reached below, or turn on “Log my place to My reading” in the{" "}
            <Link href="/quran" className="font-semibold text-gold hover:text-gold-hover">
              Quran reader
            </Link>
            .
          </p>
        )}
      </div>

      <div className="mb-6">
        <ReadingLogForm />
      </div>

      <div className="bg-white border-[0.5px] border-line rounded-card p-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft mb-2">History</div>
        <ReadingHistory entries={entries} />
      </div>
    </div>
  );
}

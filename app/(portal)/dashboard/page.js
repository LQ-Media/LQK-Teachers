import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { formatDate, formatDateLong, isSameWeek } from "@/lib/date";
import StatusPill from "@/components/StatusPill";
import SolatWidget from "@/components/SolatWidget";

export default async function DashboardPage({ searchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const db = getDb();

  const hafalanEntries = db
    .prepare("SELECT * FROM hafalan_entries WHERE teacher_id = ? ORDER BY created_at DESC")
    .all(session.userId);
  const readingEntries = db
    .prepare("SELECT * FROM reading_entries WHERE teacher_id = ? ORDER BY created_at DESC")
    .all(session.userId);

  const pendingCount = hafalanEntries.filter((e) => e.status === "pending").length;
  const readingThisWeek = readingEntries.filter((e) => isSameWeek(new Date(e.created_at), new Date())).length;

  return (
    <div className="p-8 max-w-5xl">
      {sp?.denied && (
        <div className="bg-rust-soft text-[#8A4030] text-[13px] font-medium rounded-control px-4 py-3 mb-5">
          You don't have access to that page.
        </div>
      )}
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">
          Assalamualaikum, {session.fullName.split(" ")[0]}
        </h1>
        <p className="text-[13px] text-charcoal-soft mt-1">
          {session.primaryLocation ?? "No location assigned"} · {formatDateLong(new Date())}
        </p>
      </div>

      <div className="mb-6">
        <SolatWidget />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Work hours" value="Soon" note="Clock in/out arrives in the next phase" />
        <StatCard
          label="My hafalan awaiting review"
          value={String(pendingCount)}
          note={pendingCount === 1 ? "entry pending" : "entries pending"}
        />
        <StatCard
          label="Reading this week"
          value={String(readingThisWeek)}
          note={readingThisWeek === 1 ? "entry logged" : "entries logged"}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SummaryCard title="My hafalan" viewAllHref="/hafalan">
          {hafalanEntries.slice(0, 3).map((entry) => (
            <li key={entry.id} className="flex items-center justify-between py-2.5 border-b-[0.5px] border-line last:border-0">
              <div>
                <div className="text-[13px] font-medium text-charcoal">{entry.surah_name}</div>
                <div className="text-[11px] text-charcoal-soft">{formatDate(entry.created_at)}</div>
              </div>
              <StatusPill status={entry.status === "pending" ? "pending" : entry.status === "approved" ? "mutqin" : "needs_review"} label={entry.status === "pending" ? "Awaiting review" : entry.status === "approved" ? "Approved" : "Rejected"} />
            </li>
          ))}
          {hafalanEntries.length === 0 && <EmptyRow text="No hafalan entries yet." />}
        </SummaryCard>

        <SummaryCard title="My reading" viewAllHref="/reading">
          {readingEntries.slice(0, 3).map((entry) => (
            <li key={entry.id} className="flex items-center justify-between py-2.5 border-b-[0.5px] border-line last:border-0">
              <div className="text-[13px] font-medium text-charcoal">
                {entry.entry_type === "surah" ? `Completed ${entry.surah_name}` : `Reading session · ${entry.session_minutes} minutes`}
              </div>
              <div className="text-[11px] text-charcoal-soft">{formatDate(entry.created_at)}</div>
            </li>
          ))}
          {readingEntries.length === 0 && <EmptyRow text="No reading entries yet." />}
        </SummaryCard>
      </div>
    </div>
  );
}

function StatCard({ label, value, note }) {
  return (
    <div className="bg-white border-[0.5px] border-line rounded-card p-[18px]">
      <div className="text-[11px] font-semibold text-charcoal-soft mb-1">{label}</div>
      <div className="font-heading text-2xl font-semibold text-ink mb-1">{value}</div>
      <div className="text-[11px] text-charcoal-soft">{note}</div>
    </div>
  );
}

function SummaryCard({ title, viewAllHref, children }) {
  return (
    <div className="bg-white border-[0.5px] border-line rounded-card p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft">{title}</div>
        <Link href={viewAllHref} className="text-[12px] font-semibold text-ink hover:text-ink-deep">
          View all →
        </Link>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function EmptyRow({ text }) {
  return <li className="py-3 text-[12px] text-charcoal-soft">{text}</li>;
}

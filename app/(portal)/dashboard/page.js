import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { allowedClassesFor } from "@/lib/tracker/access";
import { sheetRoster } from "@/lib/tracker/sheet";
import { formatDate, formatDateLong, isSameWeek } from "@/lib/date";
import { titleCase } from "@/components/tracker/util";
import SolatWidget from "@/components/SolatWidget";

export default async function DashboardPage({ searchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const db = getDb();

  const readingEntries = db
    .prepare("SELECT * FROM reading_entries WHERE teacher_id = ? ORDER BY created_at DESC")
    .all(session.userId);
  const readingThisWeek = readingEntries.filter((e) => isSameWeek(new Date(e.created_at), new Date())).length;

  // Quran-tracker summary — read live from the Google Sheet for the classes this
  // user can see. Best-effort: a Sheet hiccup must not break the dashboard.
  const classes = allowedClassesFor(session);
  let classSummary = [];
  if (classes.length) {
    const rosters = await Promise.all(
      classes.map((cls) =>
        sheetRoster(cls)
          .then((students) => ({ cls, total: students.length, logged: students.filter((s) => s.logged).length }))
          .catch(() => null)
      )
    );
    classSummary = rosters.filter(Boolean);
  }
  const studentTotal = classSummary.reduce((a, c) => a + c.total, 0);
  const loggedToday = classSummary.reduce((a, c) => a + c.logged, 0);

  return (
    <div className="p-8 max-w-5xl">
      {sp?.denied && (
        <div className="bg-rust-soft text-[#8A4030] text-[13px] font-medium rounded-control px-4 py-3 mb-5">
          You don’t have access to that page.
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
          label="Logged today"
          value={classSummary.length ? `${loggedToday}/${studentTotal}` : "—"}
          note={classes.length ? "students logged" : "no class assigned"}
        />
        <StatCard
          label="Reading this week"
          value={String(readingThisWeek)}
          note={readingThisWeek === 1 ? "entry logged" : "entries logged"}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SummaryCard title="Quran tracker" viewAllHref="/hafalan">
          {classSummary.map((c) => (
            <li key={c.cls} className="flex items-center justify-between py-2.5 border-b-[0.5px] border-line last:border-0">
              <div className="text-[13px] font-medium text-charcoal">{titleCase(c.cls)}</div>
              <span className="text-[12px] text-charcoal-soft">
                {c.logged}/{c.total} logged today
              </span>
            </li>
          ))}
          {classSummary.length === 0 && (
            <EmptyRow text={classes.length ? "Couldn’t reach the register." : "No class assigned yet."} />
          )}
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

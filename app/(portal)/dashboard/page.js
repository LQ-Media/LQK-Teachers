import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { allowedClassesFor } from "@/lib/tracker/access";
import { sheetRoster } from "@/lib/tracker/sheet";
import { formatDate, isSameWeek } from "@/lib/date";
import { titleCase } from "@/components/tracker/util";
import SolatWidget from "@/components/SolatWidget";
import HeroClock from "@/components/dashboard/HeroClock";
import Icon from "@/components/Icon";

export default async function DashboardPage({ searchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const db = getDb();
  const firstName = session.fullName ? session.fullName.split(" ")[0] : "there";

  const readingEntries = db
    .prepare("SELECT * FROM reading_entries WHERE teacher_id = ? ORDER BY created_at DESC")
    .all(session.userId);
  const readingThisWeek = readingEntries.filter((e) => isSameWeek(new Date(e.created_at), new Date())).length;

  // Quran-tracker summary read live from the Sheet for the caller's classes.
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
    <div className="min-h-screen bg-paper">
      {sp?.denied && (
        <div className="mx-6 mt-6 rounded-control bg-rust-soft px-4 py-3 text-[13px] font-medium text-[#8A4030]">
          You don’t have access to that page.
        </div>
      )}

      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-white to-[#faf5ed] px-6 py-12 md:px-10">
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-center gap-8 text-center md:flex-row md:text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/mascot-ustazah.png"
            alt="Little Quran Kids teacher and student"
            className="h-[170px] w-auto flex-shrink-0 object-contain drop-shadow-[0_10px_20px_rgba(51,58,34,0.12)]"
          />
          <div>
            <h1 className="font-heading text-[32px] font-bold leading-tight text-charcoal md:text-[36px]">
              Assalamualaikum, {firstName}.
            </h1>
            <HeroClock />
          </div>
        </div>
      </div>

      {/* Prayer times (overlaps the hero slightly) */}
      <div className="relative z-10 mx-auto -mt-6 max-w-[1100px] px-6 md:px-10">
        <SolatWidget />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-[1100px] px-6 py-10 md:px-10">
        <div className="mb-10 grid gap-6 sm:grid-cols-3">
          <StatCard delay={0} tint="sand" icon="clock" label="Work hours" value="Soon" valueClass="text-gold" note="Clock in when you arrive" />
          <StatCard
            delay={100}
            tint="white"
            icon="clipboard-check"
            label="Students logged"
            value={classSummary.length ? `${loggedToday} / ${studentTotal}` : "—"}
            note="Today"
          />
          <StatCard delay={200} tint="white" icon="notebook" label="Reading entries" value={String(readingThisWeek)} note="This week" />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <TrackerCard title="Quran tracker" href="/hafalan" image="/card-tracker.png">
            {classSummary.length ? (
              <ul className="space-y-1.5">
                {classSummary.map((c) => (
                  <li key={c.cls} className="flex items-center justify-between text-[13px]">
                    <span className="text-charcoal">{titleCase(c.cls)}</span>
                    <span className="text-charcoal-soft">
                      {c.logged}/{c.total} today
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-charcoal-soft">
                {classes.length ? "Couldn’t reach the register." : "No class assigned yet."}
              </p>
            )}
          </TrackerCard>

          <TrackerCard title="My reading" href="/reading" image="/card-recitation.png">
            {readingEntries.length ? (
              <ul className="space-y-1.5">
                {readingEntries.slice(0, 3).map((e) => (
                  <li key={e.id} className="flex items-center justify-between text-[13px]">
                    <span className="text-charcoal">
                      {e.entry_type === "surah" ? `Completed ${e.surah_name}` : `Reading · ${e.session_minutes} min`}
                    </span>
                    <span className="text-charcoal-soft">{formatDate(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-charcoal-soft">No reading entries yet. Log a session to get started.</p>
            )}
          </TrackerCard>
        </div>
      </div>
    </div>
  );
}

function StatCard({ tint, icon, label, value, note, valueClass, delay }) {
  const bg = tint === "sand" ? "bg-gradient-to-br from-sand to-[#e8dfc8]" : "bg-white";
  return (
    <div
      className={`lqk-rise rounded-card ${bg} p-6 shadow-[0_8px_24px_rgba(51,58,34,0.08)]`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-3 flex items-center gap-3">
        <span className="text-ink">
          <Icon name={icon} size={26} strokeWidth={1.5} />
        </span>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-charcoal-soft">{label}</span>
      </div>
      <div className={`font-heading text-[22px] font-bold ${valueClass || "text-charcoal"}`}>{value}</div>
      <div className="text-[13px] text-charcoal-soft">{note}</div>
    </div>
  );
}

function TrackerCard({ title, href, image, children }) {
  return (
    <div className="lqk-rise relative overflow-hidden rounded-card border border-line bg-white p-7">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt=""
        className="-mx-7 -mt-7 mb-5 block h-[120px] w-[calc(100%+56px)] max-w-none object-cover"
      />
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-heading text-[16px] font-bold text-charcoal">{title}</h3>
        <Link href={href} className="text-[12px] font-semibold text-gold hover:text-gold-hover">
          View all →
        </Link>
      </div>
      {children}
    </div>
  );
}

import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { allowedClassesFor } from "@/lib/tracker/access";
import { formatDate, isSameWeek } from "@/lib/date";
import { formatHM, minutesBetween, sgMonth, sgMonthNow } from "@/lib/hours/rates";
import { titleCase } from "@/components/tracker/util";
import SolatWidget from "@/components/SolatWidget";
import HeroClock from "@/components/dashboard/HeroClock";
import DailyBrief from "@/components/dashboard/DailyBrief";
import { spotImage } from "@/lib/spot";

export default async function DashboardPage({ searchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const db = getDb();
  const firstName = session.fullName ? session.fullName.split(" ")[0] : "there";

  const readingEntries = db
    .prepare(
      "SELECT * FROM reading_entries WHERE teacher_id = ? ORDER BY COALESCE(read_at, created_at) DESC, created_at DESC"
    )
    .all(session.userId);
  const readingThisWeek = readingEntries.filter((e) =>
    isSameWeek(new Date(e.read_at || e.created_at), new Date())
  ).length;

  // Quran-tracker summary from the app DB for the caller's classes.
  const now = new Date();
  const sg = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const today = `${sg.getFullYear()}-${String(sg.getMonth() + 1).padStart(2, "0")}-${String(sg.getDate()).padStart(2, "0")}`;
  const classes = allowedClassesFor(session);
  const totalStmt = db.prepare("SELECT COUNT(*) AS c FROM students WHERE class = ?");
  const loggedStmt = db.prepare("SELECT COUNT(DISTINCT student_id) AS c FROM lessons WHERE class = ? AND date = ?");
  const classSummary = classes.map((cls) => ({
    cls,
    total: totalStmt.get(cls).c,
    logged: loggedStmt.get(cls, today).c,
  }));
  const studentTotal = classSummary.reduce((a, c) => a + c.total, 0);
  const loggedToday = classSummary.reduce((a, c) => a + c.logged, 0);

  // Work hours logged this month (excludes rejected), plus whether they're
  // clocked in right now.
  const thisMonth = sgMonthNow();
  const nowIso = new Date().toISOString();
  // `ended_at <= now`, not just "not null": a rostered session carries a FUTURE
  // ended_at for the whole shift, so the old test would count hours nobody has
  // worked yet.
  const workMinutes = db
    .prepare(
      "SELECT started_at, ended_at FROM work_sessions WHERE teacher_id = ? AND ended_at IS NOT NULL AND ended_at <= ? AND status != 'rejected'"
    )
    .all(session.userId, nowIso)
    .filter((r) => sgMonth(r.started_at) === thisMonth)
    .reduce((a, r) => a + minutesBetween(r.started_at, r.ended_at), 0);
  // Clocked in = an open unscheduled session, OR mid-way through a rostered
  // shift they've tapped into. A rostered session is created already closed, so
  // `ended_at IS NULL` alone would read false forever.
  const clockedIn = !!db
    .prepare(
      `SELECT 1 FROM work_sessions
       WHERE teacher_id = ?
         AND (ended_at IS NULL
              OR (shift_id IS NOT NULL AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
                  AND started_at <= ? AND ended_at > ?))
       LIMIT 1`
    )
    .get(session.userId, nowIso, nowIso);

  return (
    <div className="min-h-screen bg-paper">
      {/* Shown once per Singapore day, and only after the client confirms it is
          due — see the component for why the scores aren't computed here. */}
      <DailyBrief />

      {sp?.denied && (
        <div className="mx-6 mt-6 rounded-control bg-rust-soft px-4 py-3 text-[13px] font-medium text-[#8E3A24]">
          You don’t have access to that page.
        </div>
      )}

      {/* Hero. Flat cream, same as the body below it — the page reads as one
          surface with white cards floating on it, so the hero needs no band of
          its own. (The lantern/crescent/stars props that used to frame the
          greeting were removed; the faded cut-outs on the stat tiles stay.) */}
      <div className="relative overflow-hidden bg-paper px-6 pb-12 pt-6 md:px-10">
        {/* eslint-disable @next/next/no-img-element */}
        <div className="relative mx-auto max-w-[1100px] text-center">
          <img
            src="/hero-dashboard.png"
            alt=""
            aria-hidden="true"
            className="mx-auto mb-1 h-[132px] w-auto select-none md:h-[164px]"
          />
          <h1 className="font-heading text-[32px] font-bold leading-tight text-charcoal md:text-[36px]">
            Assalamualaikum, {firstName}.
          </h1>
          <HeroClock />
        </div>
        {/* eslint-enable @next/next/no-img-element */}
      </div>

      {/* Prayer times (overlaps the hero slightly) */}
      <div className="relative z-10 mx-auto -mt-6 max-w-[1100px] px-6 md:px-10">
        <SolatWidget />
      </div>

      {/* Content */}
      <div className="mx-auto max-w-[1100px] px-6 py-10 md:px-10">
        {/* Always three across — on a 360px phone that leaves ~104px a tile, so
            the tile scales (padding, art, type, prop) rather than wrapping. */}
        <div className="mb-10 grid grid-cols-3 gap-2.5 sm:gap-6">
          <StatCard
            delay={0}
            tint="honey"
            art="/hours"
            prop="crescent"
            label="Work hours"
            value={formatHM(workMinutes)}
            note={clockedIn ? "Clocked in now" : "This month"}
          />
          <StatCard
            delay={100}
            tint="clay"
            art="/hafalan"
            prop="stars"
            label="Students logged"
            value={classSummary.length ? `${loggedToday} / ${studentTotal}` : "—"}
            note="Today"
          />
          <StatCard
            delay={200}
            tint="sage"
            art="/reading"
            prop="cloud"
            label="Reading entries"
            value={String(readingThisWeek)}
            note="This week"
          />
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
                      {e.entry_type === "surah" ? `Last read ${e.surah_name}` : `Reading · ${e.session_minutes} min`}
                    </span>
                    <span className="text-charcoal-soft">{formatDate(e.read_at || e.created_at)}</span>
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

// One natural tone per tile — honey / clay / sage, each fading toward a paler
// self so the row reads airy rather than blocky. Label colours are the tone's
// dark partner (never the cream-tuned muted, which fails on a tint).
const STAT_TINTS = {
  honey: { bg: "bg-gradient-to-br from-sand to-[#FCEFD6]", label: "text-[#6E5320]" },
  clay: { bg: "bg-gradient-to-br from-sage-soft to-[#F9E7DC]", label: "text-[#7A4630]" },
  sage: { bg: "bg-gradient-to-br from-gold-soft to-[#EAF0E3]", label: "text-[#3E5438]" },
  white: { bg: "bg-white", label: "text-charcoal-soft" },
};

// Where each clay prop leaves the card. The lantern hangs, so its cord has to
// run off the TOP edge — crop it at the bottom and it reads as a jar. Widths
// come in pairs: at three-up on a phone the full-size prop would be wider than
// the tile itself and swallow the number.
const PROP_PLACE = {
  lantern: "-top-3 right-2 w-10 sm:-top-7 sm:right-6 sm:w-20",
  cloud: "-bottom-2 -right-2 w-12 sm:-bottom-5 sm:-right-4 sm:w-28",
  stars: "-bottom-2 -right-1 w-14 sm:-bottom-4 sm:-right-2 sm:w-32",
  crescent: "-bottom-2 -right-2 w-11 sm:-bottom-6 sm:-right-4 sm:w-24",
  default: "-bottom-2 -right-2 w-12 sm:-bottom-6 sm:-right-5 sm:w-28",
};

function StatCard({ tint, art, prop, label, value, note, valueClass, delay }) {
  const t = STAT_TINTS[tint] || STAT_TINTS.white;
  return (
    <div
      className={`lqk-rise relative overflow-hidden rounded-card ${t.bg} p-3 shadow-[0_8px_24px_rgba(59,55,43,0.08)] sm:p-6`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Clay prop bleeding off one edge. It is a transparent cut-out held at
          low opacity, so it reads as part of the tint rather than a sticker on
          top. Each prop leaves by the edge its own gravity implies (see
          PROP_PLACE). */}
      {prop ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/prop/${prop}.png`}
          alt=""
          aria-hidden="true"
          className={`pointer-events-none absolute select-none opacity-25 sm:opacity-45 ${
            PROP_PLACE[prop] || PROP_PLACE.default
          }`}
        />
      ) : null}
      {/* Art over label on a phone, beside it once there's room: side-by-side at
          104px wide would leave the label two characters a line. */}
      <div className="relative mb-1.5 flex flex-col items-start gap-1 sm:mb-3 sm:flex-row sm:items-center sm:gap-3">
        {/* The destination's own clay render, not a line icon: at 34px it reads
            clearly, and reusing the page's art ties the tile to where it goes. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={spotImage(art)}
          alt=""
          width={34}
          height={34}
          className="h-[22px] w-[22px] flex-shrink-0 sm:h-[34px] sm:w-[34px]"
        />
        <span
          className={`text-[9.5px] font-semibold uppercase leading-tight tracking-wide sm:text-[12px] ${t.label}`}
        >
          {label}
        </span>
      </div>
      <div
        className={`relative font-heading text-[15px] font-bold leading-tight sm:text-[22px] ${
          valueClass || "text-charcoal"
        }`}
      >
        {value}
      </div>
      <div className={`relative text-[9.5px] leading-tight sm:text-[13px] ${t.label}`}>{note}</div>
    </div>
  );
}

function TrackerCard({ title, href, image, children }) {
  return (
    <div className="lqk-rise group relative overflow-hidden rounded-card border border-line bg-white p-7 shadow-[0_1px_2px_rgba(59,55,43,0.04)] transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(59,55,43,0.10)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
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

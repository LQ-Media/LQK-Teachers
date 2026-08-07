import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { allowedClassesFor } from "@/lib/tracker/access";
import { formatDate, isSameWeek } from "@/lib/date";
import { formatHM, minutesBetween, sgMonth, sgMonthNow } from "@/lib/hours/rates";
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
  const workMinutes = db
    .prepare(
      "SELECT started_at, ended_at FROM work_sessions WHERE teacher_id = ? AND ended_at IS NOT NULL AND status != 'rejected'"
    )
    .all(session.userId)
    .filter((r) => sgMonth(r.started_at) === thisMonth)
    .reduce((a, r) => a + minutesBetween(r.started_at, r.ended_at), 0);
  const clockedIn = !!db
    .prepare("SELECT 1 FROM work_sessions WHERE teacher_id = ? AND ended_at IS NULL")
    .get(session.userId);

  return (
    <div className="min-h-screen bg-paper">
      {sp?.denied && (
        <div className="mx-6 mt-6 rounded-control bg-rust-soft px-4 py-3 text-[13px] font-medium text-[#8E3D52]">
          You don’t have access to that page.
        </div>
      )}

      {/* Hero. The welcome party and the corner props are white-ground renders
          composited with multiply (see components/EmptyArt for why) — this
          gradient runs white → cream, so their plates vanish into it. */}
      <div className="relative overflow-hidden bg-gradient-to-br from-white to-paper-deep px-6 pb-12 pt-6 md:px-10">
        {/* eslint-disable @next/next/no-img-element */}
        {/* The lantern hangs off the hero's top edge — the one place in the
            portal with a "ceiling" for its cord to disappear into. */}
        <img
          src="/prop/lantern.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -top-4 left-10 hidden w-20 select-none opacity-70 mix-blend-multiply md:block"
        />
        <img
          src="/prop/crescent.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -left-8 bottom-6 hidden w-24 select-none opacity-70 mix-blend-multiply md:block"
        />
        <img
          src="/prop/stars.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-1 hidden w-36 select-none opacity-70 mix-blend-multiply md:block"
        />
        <div className="relative mx-auto max-w-[1100px] text-center">
          <img
            src="/hero-dashboard.png"
            alt=""
            aria-hidden="true"
            className="mx-auto mb-1 h-[132px] w-auto select-none mix-blend-multiply md:h-[164px]"
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
        <div className="mb-10 grid gap-6 sm:grid-cols-3">
          <StatCard
            delay={0}
            tint="sand"
            icon="clock"
            prop="crescent"
            label="Work hours"
            value={formatHM(workMinutes)}
            note={clockedIn ? "Clocked in now" : "This month"}
          />
          <StatCard
            delay={100}
            tint="rose"
            icon="clipboard-check"
            prop="stars"
            label="Students logged"
            value={classSummary.length ? `${loggedToday} / ${studentTotal}` : "—"}
            note="Today"
          />
          <StatCard
            delay={200}
            tint="lavender"
            icon="notebook"
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

// One brand pastel per tile — peach / rose / lavender, each fading toward a
// paler self so the row reads airy rather than blocky. Label colours are the
// pastel's dark partner (never the cream-tuned muted, which fails on pastel).
const STAT_TINTS = {
  sand: { bg: "bg-gradient-to-br from-sand to-[#FDEEE2]", label: "text-[#6E4830]" },
  rose: { bg: "bg-gradient-to-br from-sage-soft to-[#FBE9EE]", label: "text-[#6B3E4C]" },
  lavender: { bg: "bg-gradient-to-br from-gold-soft to-[#EFEAF8]", label: "text-[#4A3D63]" },
  white: { bg: "bg-white", label: "text-charcoal-soft" },
};

// Where each clay prop leaves the card. The lantern hangs, so its cord has to
// run off the TOP edge — crop it at the bottom and it reads as a jar.
const PROP_PLACE = {
  lantern: "-top-7 right-6 w-20",
  cloud: "-bottom-5 -right-4 w-28",
  stars: "-bottom-4 -right-2 w-32",
  crescent: "-bottom-6 -right-4 w-24",
  default: "-bottom-6 -right-5 w-28",
};

function StatCard({ tint, icon, prop, label, value, note, valueClass, delay }) {
  const t = STAT_TINTS[tint] || STAT_TINTS.white;
  return (
    <div
      className={`lqk-rise relative overflow-hidden rounded-card ${t.bg} p-6 shadow-[0_8px_24px_rgba(64,53,72,0.08)]`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Clay prop bleeding off one edge — multiply drops its white plate onto
          the pastel, so it tints rather than sitting on top. Each prop leaves
          by the edge its own gravity implies (see PROP_PLACE). */}
      {prop ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/prop/${prop}.png`}
          alt=""
          aria-hidden="true"
          className={`pointer-events-none absolute select-none opacity-45 mix-blend-multiply ${
            PROP_PLACE[prop] || PROP_PLACE.default
          }`}
        />
      ) : null}
      <div className="relative mb-3 flex items-center gap-3">
        <span className="text-ink">
          <Icon name={icon} size={26} strokeWidth={1.5} />
        </span>
        <span className={`text-[12px] font-semibold uppercase tracking-wide ${t.label}`}>{label}</span>
      </div>
      <div className={`relative font-heading text-[22px] font-bold ${valueClass || "text-charcoal"}`}>
        {value}
      </div>
      <div className={`relative text-[13px] ${t.label}`}>{note}</div>
    </div>
  );
}

function TrackerCard({ title, href, image, children }) {
  return (
    <div className="lqk-rise group relative overflow-hidden rounded-card border border-line bg-white p-7 shadow-[0_1px_2px_rgba(64,53,72,0.04)] transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(64,53,72,0.10)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
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

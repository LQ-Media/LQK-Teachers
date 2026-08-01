import { requireSession } from "@/lib/dal";
import { getDb, LOCATIONS } from "@/lib/db";
import {
  sgMonthNow,
  sgMonth,
  monthLabel,
  minutesBetween,
  isLongSession,
  payCents,
  rateFor,
  teachingRate,
} from "@/lib/hours/rates";
import HoursApp from "@/components/hours/HoursApp";

export const metadata = { title: "Work hours · LQK Teachers Portal" };

// Shape a DB row into a plain object for the client (node:sqlite rows have a
// null prototype and can't cross the server→client boundary directly).
function shape(row) {
  return {
    id: row.id,
    category: row.category,
    otReason: row.ot_reason || null,
    branch: row.branch || null,
    startedAt: row.started_at,
    endedAt: row.ended_at || null,
    note: row.note || null,
    status: row.status,
    rateCents: row.rate_cents ?? null,
    reviewerNote: row.reviewer_note || null,
    minutes: row.ended_at ? minutesBetween(row.started_at, row.ended_at) : null,
    long: isLongSession(row.started_at, row.ended_at),
  };
}

export default async function HoursPage() {
  const session = await requireSession();
  const db = getDb();
  const uid = session.userId;
  const month = sgMonthNow();

  const prof = db.prepare("SELECT pay_tier, primary_location FROM profiles WHERE id = ?").get(uid) || {};
  const tierRate = teachingRate(prof.pay_tier);

  // Branch options: the teacher's own branches (primary first), else all.
  const locRows = db.prepare("SELECT location, is_primary FROM teacher_locations WHERE teacher_id = ?").all(uid);
  const locs = [];
  const seen = new Set();
  const add = (l) => {
    if (l && !seen.has(l)) {
      seen.add(l);
      locs.push(l);
    }
  };
  add(prof.primary_location);
  for (const r of [...locRows].sort((a, b) => b.is_primary - a.is_primary)) add(r.location);
  const branchOptions = locs.length ? locs : LOCATIONS;

  const runningRow = db.prepare("SELECT * FROM work_sessions WHERE teacher_id = ? AND ended_at IS NULL").get(uid);
  const running = runningRow ? shape(runningRow) : null;

  const sessions = db
    .prepare("SELECT * FROM work_sessions WHERE teacher_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC")
    .all(uid)
    .filter((r) => sgMonth(r.started_at) === month)
    .map(shape);

  // Month totals (exclude rejected). Approved pay uses the snapshotted rate;
  // pending pay is an estimate at the teacher's current rate.
  let teachingMinutes = 0;
  let otMinutes = 0;
  let approvedCents = 0;
  let pendingCents = 0;
  for (const s of sessions) {
    if (s.status === "rejected") continue;
    if (s.category === "ot") otMinutes += s.minutes;
    else teachingMinutes += s.minutes;
    const rDollars = s.status === "approved" && s.rateCents != null ? s.rateCents / 100 : rateFor(s.category, prof.pay_tier);
    const cents = payCents(s.minutes, rDollars);
    if (s.status === "approved") approvedCents += cents;
    else pendingCents += cents;
  }

  return (
    <HoursApp
      firstName={session.fullName ? session.fullName.split(" ")[0] : "there"}
      payTier={prof.pay_tier || null}
      tierRate={tierRate}
      month={month}
      monthName={monthLabel(month)}
      branchOptions={branchOptions}
      running={running}
      sessions={sessions}
      totals={{ teachingMinutes, otMinutes, approvedCents, pendingCents }}
    />
  );
}

import "server-only";
import { getDb } from "@/lib/db";
import { sgMonth, sgToday } from "@/lib/hours/rates";
import { surahByNumber } from "@/lib/quran/surah-list";
import { POINTS, STREAK_MIN_SECONDS, BADGES, levelFor } from "./points";

// The scoring engine.
//
// Nothing is stored: every score is recomputed from the raw records each time
// the page renders, so changing a weight in points.js takes effect immediately
// and there is no cache to invalidate or backfill to run. One pass over the
// whole org is a handful of indexed queries plus in-memory aggregation — at LQK
// scale (~76 accounts, thousands of lessons) that is a few milliseconds.
//
// Every date here is a Singapore calendar date. lessons.date and
// reader_activity.date are already stored that way; ISO instants go through
// sgMonth() from lib/hours/rates.js rather than new date maths.

// Lessons dated before this launched count toward all-time scores and earn the
// "Since the Beginning" badge, but never toward a monthly season — so the first
// season starts everyone level.
export const LAUNCH_DATE = "2026-08-01";

function emptyStats() {
  return {
    readingDays: 0,
    currentStreak: 0,
    longestStreak: 0,
    bestDaySeconds: 0,
    totalReadingSeconds: 0,
    lessonsAsLearner: 0,
    gradeCounts: { Excellent: 0, Pass: 0, Repeat: 0 },
    bestExcellentRun: 0,
    surahsCompleted: 0,
    juzCompleted: 0,
    lessonsLogged: 0,
    certsApproved: 0,
    monthlyTitles: 0,
    oneoffAwards: 0,
    nominationsReceived: 0,
    founding: false,
  };
}

// A per-teacher accumulator: totals plus points bucketed by category and by
// month, so the same pass answers both "all time" and "this month".
function emptyEntry() {
  return {
    stats: emptyStats(),
    // category -> all-time points
    byCategory: { reading: 0, hafalan: 0, teaching: 0, recognition: 0 },
    // "YYYY-MM" -> { total, reading, hafalan, teaching, recognition }
    byMonth: new Map(),
    allTime: 0,
  };
}

function credit(entry, category, points, month) {
  if (!points) return;
  entry.allTime += points;
  entry.byCategory[category] += points;
  // Anything predating the launch feeds all-time only (fair first season).
  if (!month || month < LAUNCH_DATE.slice(0, 7)) return;
  let m = entry.byMonth.get(month);
  if (!m) {
    m = { total: 0, reading: 0, hafalan: 0, teaching: 0, recognition: 0 };
    entry.byMonth.set(month, m);
  }
  m.total += points;
  m[category] += points;
}

/**
 * Longest and current streak from a sorted list of qualifying SG dates, plus the
 * date on which each streak milestone was reached (so a milestone bonus lands in
 * the month it was actually earned).
 */
function streaksFrom(sortedDates, today) {
  let longest = 0;
  let run = 0;
  let prev = null;
  const milestoneDates = []; // [{ days, date }]
  const milestoneKeys = Object.keys(POINTS.reading.streakMilestones).map(Number);

  for (const date of sortedDates) {
    const isNext = prev && dayDiff(prev, date) === 1;
    run = isNext ? run + 1 : 1;
    prev = date;
    if (run > longest) longest = run;
    if (milestoneKeys.includes(run)) milestoneDates.push({ days: run, date });
  }

  // "Current" counts a run ending today or yesterday, so the number doesn't drop
  // to zero every midnight before that day's reading happens.
  let current = 0;
  const last = sortedDates[sortedDates.length - 1];
  if (last && dayDiff(last, today) <= 1) {
    current = 1;
    for (let i = sortedDates.length - 1; i > 0; i--) {
      if (dayDiff(sortedDates[i - 1], sortedDates[i]) === 1) current++;
      else break;
    }
  }

  return { longest, current, milestoneDates };
}

/** Whole days from date a to date b (both "YYYY-MM-DD"). */
function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Walk a learner's lessons in date order, tracking which ayahs of each surah
 * have been covered, and return the date each surah was completed.
 *
 * Coverage counts any logged lesson regardless of grade (the chosen rule), and a
 * surah is complete once every one of its ayahs appears in some lesson's range.
 */
function surahCompletionDates(lessons) {
  const covered = new Map(); // surah number -> Set of ayah numbers
  const completed = new Map(); // surah number -> date it was completed
  for (const l of lessons) {
    const surah = Number(l.surah);
    const info = surahByNumber(surah);
    if (!info || !l.from_ayah) continue;
    if (completed.has(surah)) continue;

    let set = covered.get(surah);
    if (!set) covered.set(surah, (set = new Set()));
    const from = Math.max(1, Number(l.from_ayah));
    const to = Math.min(info.ayahCount, Number(l.to_ayah) || from);
    for (let a = from; a <= to; a++) set.add(a);

    if (set.size >= info.ayahCount) completed.set(surah, l.date);
  }
  return completed;
}

/** Longest run of consecutive Excellent grades, in date order. */
function bestExcellentRun(lessons) {
  let best = 0;
  let run = 0;
  for (const l of lessons) {
    if (l.grade === "Excellent") {
      run++;
      if (run > best) best = run;
    } else if (l.grade) {
      run = 0;
    }
  }
  return best;
}

/**
 * Score every account in one pass.
 * Returns Map<profileId, entry> where entry has { stats, allTime, byCategory, byMonth }.
 */
function computeAll() {
  const db = getDb();
  const today = sgToday();
  const entries = new Map();

  const profiles = db
    .prepare("SELECT id, full_name, email, role, primary_location, photo FROM profiles")
    .all();
  for (const p of profiles) entries.set(p.id, emptyEntry());
  const entryFor = (id) => (id && entries.has(id) ? entries.get(id) : null);

  // ---- Reading (habit) ------------------------------------------------
  const activity = db
    .prepare("SELECT teacher_id, date, seconds FROM reader_activity ORDER BY teacher_id, date")
    .all();
  const daysByTeacher = new Map();
  for (const row of activity) {
    const e = entryFor(row.teacher_id);
    if (!e) continue;
    e.stats.totalReadingSeconds += row.seconds;
    if (row.seconds > e.stats.bestDaySeconds) e.stats.bestDaySeconds = row.seconds;
    if (row.seconds < STREAK_MIN_SECONDS) continue; // too short to count as a day

    e.stats.readingDays++;
    if (!daysByTeacher.has(row.teacher_id)) daysByTeacher.set(row.teacher_id, []);
    daysByTeacher.get(row.teacher_id).push(row.date);

    const month = row.date.slice(0, 7);
    credit(e, "reading", POINTS.reading.day, month);
    const tiers = Math.floor(row.seconds / 60 / POINTS.reading.tierMinutes);
    const bonus = Math.min(POINTS.reading.maxBonusPerDay, tiers * POINTS.reading.perTier);
    credit(e, "reading", bonus, month);
  }
  for (const [teacherId, dates] of daysByTeacher) {
    const e = entryFor(teacherId);
    const { longest, current, milestoneDates } = streaksFrom(dates, today);
    e.stats.longestStreak = longest;
    e.stats.currentStreak = current;
    for (const m of milestoneDates) {
      credit(e, "reading", POINTS.reading.streakMilestones[m.days], m.date.slice(0, 7));
    }
  }

  // ---- Hafalan (their own lessons, via the roster link) ---------------
  const roster = db.prepare("SELECT id, profile_id, juz FROM students WHERE profile_id IS NOT NULL").all();
  const learnerLessons = db
    .prepare("SELECT student_id, date, surah, from_ayah, to_ayah, grade FROM lessons ORDER BY date, id")
    .all();
  const lessonsByStudent = new Map();
  for (const l of learnerLessons) {
    if (!lessonsByStudent.has(l.student_id)) lessonsByStudent.set(l.student_id, []);
    lessonsByStudent.get(l.student_id).push(l);
  }

  const juzMilestones = db.prepare("SELECT student_id, juz, date FROM juz_milestones").all();
  const juzByStudent = new Map();
  for (const j of juzMilestones) {
    if (!juzByStudent.has(j.student_id)) juzByStudent.set(j.student_id, []);
    juzByStudent.get(j.student_id).push(j);
  }

  for (const r of roster) {
    const e = entryFor(r.profile_id);
    if (!e) continue;
    const lessons = lessonsByStudent.get(r.id) || [];

    for (const l of lessons) {
      if (!l.grade) continue;
      e.stats.lessonsAsLearner++;
      if (e.stats.gradeCounts[l.grade] !== undefined) e.stats.gradeCounts[l.grade]++;
      const pts = POINTS.hafalan.grade[l.grade];
      if (pts) credit(e, "hafalan", pts, l.date.slice(0, 7));
      if (l.date < LAUNCH_DATE) e.stats.founding = true;
    }
    e.stats.bestExcellentRun = bestExcellentRun(lessons);

    const completed = surahCompletionDates(lessons);
    e.stats.surahsCompleted = completed.size;
    for (const date of completed.values()) {
      credit(e, "hafalan", POINTS.hafalan.surahCompleted, date.slice(0, 7));
    }

    // All-time juz total comes from where they are now (juz 3 = two completed);
    // only the dated increases can be credited to a month.
    const completedJuz = Math.max(0, (Number(r.juz) || 1) - 1);
    e.stats.juzCompleted = completedJuz;
    const dated = juzByStudent.get(r.id) || [];
    for (const d of dated) credit(e, "hafalan", POINTS.hafalan.juzCompleted, d.date.slice(0, 7));
    // Any juz reached before we started stamping dates: all-time only.
    const undated = Math.max(0, completedJuz - dated.length);
    if (undated > 0) credit(e, "hafalan", POINTS.hafalan.juzCompleted * undated, null);
  }

  // ---- Teaching (lessons they logged for others) ----------------------
  const logged = db
    .prepare("SELECT teacher_id, date, COUNT(*) AS c FROM lessons WHERE teacher_id IS NOT NULL GROUP BY teacher_id, date")
    .all();
  for (const row of logged) {
    const e = entryFor(row.teacher_id);
    if (!e) continue;
    e.stats.lessonsLogged += row.c;
    credit(e, "teaching", POINTS.teaching.lessonLogged * row.c, row.date.slice(0, 7));
    if (row.date < LAUNCH_DATE) e.stats.founding = true;
  }

  // ---- Recognition ----------------------------------------------------
  const certs = db
    .prepare("SELECT teacher_id, reviewed_at, created_at FROM certifications WHERE status = 'approved'")
    .all();
  for (const c of certs) {
    const e = entryFor(c.teacher_id);
    if (!e) continue;
    e.stats.certsApproved++;
    credit(e, "recognition", POINTS.recognition.certificateApproved, sgMonth(c.reviewed_at || c.created_at));
  }

  const honours = db.prepare("SELECT teacher_id, kind, month, created_at FROM honours").all();
  for (const h of honours) {
    const e = entryFor(h.teacher_id);
    if (!e) continue;
    if (h.kind === "monthly") {
      e.stats.monthlyTitles++;
      credit(e, "recognition", POINTS.recognition.monthlyTitle, h.month || sgMonth(h.created_at));
    } else {
      e.stats.oneoffAwards++;
      credit(e, "recognition", POINTS.recognition.oneoffAward, sgMonth(h.created_at));
    }
  }

  const noms = db
    .prepare("SELECT nominee_id, COUNT(*) AS c FROM nominations WHERE status = 'confirmed' GROUP BY nominee_id")
    .all();
  for (const n of noms) {
    const e = entryFor(n.nominee_id);
    if (e) e.stats.nominationsReceived = n.c;
  }

  return { entries, profiles };
}

/** Which badges a stats object has earned, and which are still locked. */
export function badgesFor(stats) {
  return BADGES.map((b) => ({
    key: b.key,
    group: b.group,
    name: b.name,
    icon: b.icon,
    criterion: b.criterion,
    earned: !!b.test(stats),
  }));
}

/**
 * Everything the Achievements page needs, in one call.
 *
 * `month` is a "YYYY-MM" season (defaults to the current SG month). Returns
 * plain objects only — node:sqlite rows have a null prototype and would throw if
 * handed to a Client Component.
 */
export function achievementsData(session, month) {
  const db = getDb();
  const season = month || sgMonth(new Date().toISOString());
  const { entries, profiles } = computeAll();

  const locRows = db.prepare("SELECT teacher_id, location, is_primary FROM teacher_locations").all();
  const branchOf = new Map();
  for (const p of profiles) if (p.primary_location) branchOf.set(p.id, p.primary_location);
  for (const r of locRows) if (r.is_primary && r.location) branchOf.set(r.teacher_id, r.location);

  const rows = profiles.map((p) => {
    const e = entries.get(p.id);
    const m = e.byMonth.get(season) || { total: 0, reading: 0, hafalan: 0, teaching: 0, recognition: 0 };
    return {
      id: p.id,
      name: p.full_name,
      photo: p.photo || null,
      role: p.role,
      branch: branchOf.get(p.id) || "",
      allTime: e.allTime,
      month: m.total,
      byCategory: e.byCategory,
      monthByCategory: m,
      stats: e.stats,
      level: levelFor(e.allTime),
    };
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const me = byId.get(session.userId) || null;

  // Rank on the season score, all-time as the tiebreak. Only accounts with a
  // score appear, so untouched accounts are never shown as zeros.
  const rank = (list, key) =>
    list
      .filter((r) => r[key] > 0)
      .sort((a, b) => b[key] - a[key] || b.allTime - a.allTime || a.name.localeCompare(b.name));

  const orgSeason = rank(rows, "month");
  const orgAllTime = rank(rows, "allTime");
  const myBranch = me?.branch || "";
  const branchSeason = rank(rows.filter((r) => r.branch === myBranch), "month");

  // Your own standing is shown to you privately as a percentile, so nobody is
  // ever displayed beneath a colleague.
  const standingIn = (list, id) => {
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return null;
    return { position: i + 1, of: list.length, topPercent: Math.max(1, Math.round(((i + 1) / list.length) * 100)) };
  };

  // Branch totals — teams compete, individuals within them are not listed.
  const branchTotals = new Map();
  for (const r of rows) {
    if (!r.branch) continue;
    const t = branchTotals.get(r.branch) || { branch: r.branch, month: 0, allTime: 0, people: 0 };
    t.month += r.month;
    t.allTime += r.allTime;
    t.people++;
    branchTotals.set(r.branch, t);
  }

  const monthlyTitle = db
    .prepare(
      `SELECT h.teacher_id, h.title, h.reason, p.full_name, p.photo
       FROM honours h JOIN profiles p ON p.id = h.teacher_id
       WHERE h.kind = 'monthly' AND h.month = ? LIMIT 1`
    )
    .get(season);

  const recentHonours = db
    .prepare(
      `SELECT h.id, h.kind, h.title, h.reason, h.month, h.created_at, p.full_name, p.id AS teacher_id, p.photo
       FROM honours h JOIN profiles p ON p.id = h.teacher_id
       ORDER BY h.created_at DESC LIMIT 8`
    )
    .all()
    .map((h) => ({
      id: h.id,
      kind: h.kind,
      title: h.title,
      reason: h.reason || "",
      month: h.month || "",
      name: h.full_name,
      teacherId: h.teacher_id,
      photo: h.photo || null,
    }));

  return {
    season,
    me: me
      ? {
          ...me,
          badges: badgesFor(me.stats),
          standing: {
            org: standingIn(orgSeason, me.id),
            branch: standingIn(branchSeason, me.id),
          },
        }
      : null,
    podium: {
      org: orgSeason.slice(0, 5).map(publicRow),
      branch: branchSeason.slice(0, 5).map(publicRow),
      allTime: orgAllTime.slice(0, 10).map(publicRow),
    },
    branches: [...branchTotals.values()].sort((a, b) => b.month - a.month || b.allTime - a.allTime),
    myBranch,
    monthlyTitle: monthlyTitle
      ? {
          teacherId: monthlyTitle.teacher_id,
          name: monthlyTitle.full_name,
          photo: monthlyTitle.photo || null,
          title: monthlyTitle.title,
          reason: monthlyTitle.reason || "",
        }
      : null,
    recentHonours,
  };
}

// What everyone is allowed to see about someone else: name, branch, score,
// level, and the two habit numbers. No hours, no pay, no tier — those stay on
// /hours and the admin view so a score can never be read back as earnings.
function publicRow(r) {
  return {
    id: r.id,
    name: r.name,
    photo: r.photo,
    branch: r.branch,
    month: r.month,
    allTime: r.allTime,
    level: r.level,
    currentStreak: r.stats.currentStreak,
    juzCompleted: r.stats.juzCompleted,
  };
}

/** Full ranked table for the admin Manage tab (everyone, including zeros). */
export function adminScoreboard(month) {
  const season = month || sgMonth(new Date().toISOString());
  const { entries, profiles } = computeAll();
  return profiles
    .map((p) => {
      const e = entries.get(p.id);
      const m = e.byMonth.get(season) || { total: 0 };
      return {
        id: p.id,
        name: p.full_name,
        email: p.email,
        role: p.role,
        branch: p.primary_location || "",
        month: m.total,
        allTime: e.allTime,
        level: levelFor(e.allTime).level,
        currentStreak: e.stats.currentStreak,
        readingDays: e.stats.readingDays,
        lessonsLogged: e.stats.lessonsLogged,
        surahsCompleted: e.stats.surahsCompleted,
        juzCompleted: e.stats.juzCompleted,
      };
    })
    .sort((a, b) => b.month - a.month || b.allTime - a.allTime || a.name.localeCompare(b.name));
}

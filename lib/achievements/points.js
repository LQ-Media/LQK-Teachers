// Achievements configuration — the single source of truth for how points are
// earned, what the levels are, and which badges exist.
//
// Edit the numbers here to rebalance. Scores are computed on read from raw
// records (lessons, reader_activity, certifications, honours), never stored, so
// a change takes effect immediately with no migration and no backfill.
//
// No DB or server-only imports: this module is shared by the server scorer and
// the client components alike (same arrangement as lib/hours/rates.js).

// ---- Point weights ----------------------------------------------------

export const POINTS = {
  reading: {
    // A day counts once the teacher has spent STREAK_MIN_SECONDS in the reader.
    day: 5,
    // Bonus tiers: +perTier for each completed block of tierMinutes in a day,
    // capped at maxPerDay so one very long sitting can't dominate the season.
    tierMinutes: 10,
    perTier: 2,
    maxBonusPerDay: 10,
    // One-off bonuses, credited on the day the streak reached that length.
    streakMilestones: { 7: 25, 30: 100, 100: 300 },
  },
  hafalan: {
    // By lesson grade, for lessons recorded against this person as the learner.
    grade: { Excellent: 10, Pass: 5, Repeat: 2 },
    surahCompleted: 50,
    juzCompleted: 200,
  },
  teaching: {
    // Lessons this person logged for someone else on the roster.
    lessonLogged: 3,
  },
  recognition: {
    certificateApproved: 100,
    monthlyTitle: 250,
    oneoffAward: 50,
  },
};

// Minimum seconds in the reader for a day to count toward the streak. The
// safeguard against opening the reader and immediately closing it.
export const STREAK_MIN_SECONDS = 30;

// How often the reader's heartbeat fires, and therefore how many seconds each
// beat credits. Kept here so the client and the server action agree.
export const HEARTBEAT_SECONDS = 30;

// A single day can never credit more than this many seconds, however many beats
// arrive. 90 minutes is far past the bonus cap and blocks a runaway client.
export const MAX_SECONDS_PER_DAY = 90 * 60;

// ---- Star levels ------------------------------------------------------

// Driven by the ALL-TIME score. Level 1 starts at zero so everyone has a star.
export const LEVELS = [
  { level: 1, min: 0 },
  { level: 2, min: 100 },
  { level: 3, min: 250 },
  { level: 4, min: 500 },
  { level: 5, min: 1000 },
  { level: 6, min: 2000 },
  { level: 7, min: 3500 },
  { level: 8, min: 5500 },
  { level: 9, min: 8000 },
  { level: 10, min: 12000 },
];

export const MAX_LEVEL = LEVELS[LEVELS.length - 1].level;

/**
 * Star level for an all-time score, with progress toward the next.
 * At max level `next` is null and progress reads 1.
 */
export function levelFor(allTimePoints) {
  const pts = Math.max(0, Number(allTimePoints) || 0);
  let current = LEVELS[0];
  for (const l of LEVELS) if (pts >= l.min) current = l;
  const next = LEVELS.find((l) => l.level === current.level + 1) || null;
  const span = next ? next.min - current.min : 0;
  return {
    level: current.level,
    min: current.min,
    nextAt: next ? next.min : null,
    toNext: next ? Math.max(0, next.min - pts) : 0,
    progress: next && span > 0 ? Math.min(1, (pts - current.min) / span) : 1,
  };
}

// ---- Badge catalogue --------------------------------------------------

// Each badge declares how to test itself against a computed `stats` object
// (see lib/achievements/score.js#statsFor), so adding a badge is one entry here
// and nothing else. `group` drives the section headings on the Me tab.
export const BADGES = [
  // Reading
  {
    key: "first-steps",
    group: "Reading",
    name: "First Steps",
    icon: "book-open",
    criterion: "Read in the Quran reader for the first time",
    test: (s) => s.readingDays >= 1,
  },
  {
    key: "week-of-light",
    group: "Reading",
    name: "Week of Light",
    icon: "sun",
    criterion: "Read 7 days in a row",
    test: (s) => s.longestStreak >= 7,
  },
  {
    key: "steadfast",
    group: "Reading",
    name: "Steadfast",
    icon: "flame",
    criterion: "Read 30 days in a row",
    test: (s) => s.longestStreak >= 30,
  },
  {
    key: "unbroken",
    group: "Reading",
    name: "Unbroken",
    icon: "award",
    criterion: "Read 100 days in a row",
    test: (s) => s.longestStreak >= 100,
  },
  {
    key: "deep-dive",
    group: "Reading",
    name: "Deep Dive",
    icon: "moon-star",
    criterion: "Spend 30 minutes reading in a single day",
    test: (s) => s.bestDaySeconds >= 30 * 60,
  },
  // Hafalan
  {
    key: "surah-complete",
    group: "Hafalan",
    name: "Surah Complete",
    icon: "check",
    criterion: "Complete your first surah",
    test: (s) => s.surahsCompleted >= 1,
  },
  {
    key: "ten-surahs",
    group: "Hafalan",
    name: "Ten Surahs",
    icon: "bookmark",
    criterion: "Complete 10 surahs",
    test: (s) => s.surahsCompleted >= 10,
  },
  {
    key: "juz-finisher",
    group: "Hafalan",
    name: "Juz Finisher",
    icon: "trophy",
    criterion: "Complete your first juz",
    test: (s) => s.juzCompleted >= 1,
  },
  {
    key: "juz-master",
    group: "Hafalan",
    name: "Juz Master",
    icon: "star",
    criterion: "Complete 5 juz",
    test: (s) => s.juzCompleted >= 5,
  },
  {
    key: "flawless",
    group: "Hafalan",
    name: "Flawless",
    icon: "sparkles",
    criterion: "Earn 10 Excellent grades in a row",
    test: (s) => s.bestExcellentRun >= 10,
  },
  // Teaching
  {
    key: "first-log",
    group: "Teaching",
    name: "First Log",
    icon: "clipboard-check",
    criterion: "Log your first lesson for a colleague",
    test: (s) => s.lessonsLogged >= 1,
  },
  {
    key: "half-century",
    group: "Teaching",
    name: "Half Century",
    icon: "pencil",
    criterion: "Log 50 lessons",
    test: (s) => s.lessonsLogged >= 50,
  },
  {
    key: "century",
    group: "Teaching",
    name: "Century",
    icon: "shield",
    criterion: "Log 100 lessons",
    test: (s) => s.lessonsLogged >= 100,
  },
  // Recognition
  {
    key: "certified",
    group: "Recognition",
    name: "Certified",
    icon: "key",
    criterion: "Have a certificate approved",
    test: (s) => s.certsApproved >= 1,
  },
  {
    key: "honoured",
    group: "Recognition",
    name: "Honoured",
    icon: "award",
    criterion: "Hold a monthly title",
    test: (s) => s.monthlyTitles >= 1,
  },
  {
    key: "peer-favourite",
    group: "Recognition",
    name: "Peer Favourite",
    icon: "users",
    criterion: "Be nominated by 3 colleagues",
    test: (s) => s.nominationsReceived >= 3,
  },
  {
    key: "since-the-beginning",
    group: "Recognition",
    name: "Since the Beginning",
    icon: "sunrise",
    criterion: "Had lessons on record before Achievements launched",
    test: (s) => s.founding === true,
  },
];

export const BADGE_GROUPS = ["Reading", "Hafalan", "Teaching", "Recognition"];

// ---- Formatting -------------------------------------------------------

export function formatPoints(n) {
  return (Math.round(Number(n) || 0)).toLocaleString("en-SG");
}

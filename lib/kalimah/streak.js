import "server-only";

/**
 * Consecutive days completed, up to and including `today`.
 *
 * Lives here rather than in lib/actions/kalimah.js because every export of a
 * "use server" module must be an async Server Action — a sync helper exported
 * from one is a build error, not a runtime surprise.
 */
export function streakFor(db, teacherId, today) {
  const done = new Set(
    db.prepare("SELECT date FROM kalimah_progress WHERE teacher_id = ?").all(teacherId).map((r) => r.date)
  );
  if (!done.has(today)) return 0;

  let streak = 0;
  const cursor = new Date(`${today}T00:00:00Z`);
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (!done.has(key)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

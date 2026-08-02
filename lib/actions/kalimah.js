"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { sgToday } from "@/lib/hours/rates";
import { verseForDate } from "@/lib/kalimah/verses";
import { streakFor } from "@/lib/kalimah/streak";

/**
 * Record that a teacher finished today's word study.
 *
 * Idempotent per day: repeating the quiz keeps the BEST score rather than the
 * latest. The point is to encourage a second attempt after getting one wrong,
 * not to punish it.
 */
export async function recordKalimah({ score, total, wordsSeen } = {}) {
  const session = await requireSession();
  const today = sgToday();
  const verseKey = verseForDate(today);

  const s = Math.max(0, Math.min(99, Number(score) || 0));
  const t = Math.max(0, Math.min(99, Number(total) || 0));
  const w = Math.max(0, Math.min(999, Number(wordsSeen) || 0));

  const db = getDb();
  const existing = db
    .prepare("SELECT id, score FROM kalimah_progress WHERE teacher_id = ? AND date = ?")
    .get(session.userId, today);

  if (existing) {
    if (s > existing.score) {
      db.prepare("UPDATE kalimah_progress SET score = ?, total = ? WHERE id = ?").run(s, t, existing.id);
    }
  } else {
    db.prepare(
      `INSERT INTO kalimah_progress (id, teacher_id, date, verse_key, score, total, words_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), session.userId, today, verseKey, s, t, w, new Date().toISOString());
  }

  revalidatePath("/kalimah");
  return { ok: true, streak: streakFor(db, session.userId, today) };
}

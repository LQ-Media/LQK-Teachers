"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { surahName } from "@/lib/surahs";

export async function logReading(formData) {
  const session = await requireSession();
  const entryType = String(formData.get("entry_type") || "");
  const db = getDb();
  const now = new Date().toISOString();

  if (entryType === "surah") {
    const surahNumber = Number(formData.get("surah_number"));
    if (!surahNumber) return;
    db.prepare(`
      INSERT INTO reading_entries (id, teacher_id, entry_type, surah_number, surah_name, created_at)
      VALUES (?, ?, 'surah', ?, ?, ?)
    `).run(randomUUID(), session.userId, surahNumber, surahName(surahNumber), now);
  } else if (entryType === "session") {
    const minutes = Number(formData.get("session_minutes"));
    if (!minutes || minutes <= 0) return;
    db.prepare(`
      INSERT INTO reading_entries (id, teacher_id, entry_type, session_minutes, created_at)
      VALUES (?, ?, 'session', ?, ?)
    `).run(randomUUID(), session.userId, minutes, now);
  }

  revalidatePath("/reading");
  revalidatePath("/dashboard");
}

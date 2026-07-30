"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { surahByNumber } from "@/lib/quran/surah-list";

// Clients send `read_at` as a full ISO string they built from a
// datetime-local value in the reader's own timezone, so it is unambiguous
// here. Anything unparseable falls back to now.
function normaliseReadAt(value, fallbackIso) {
  const raw = String(value || "").trim();
  if (!raw) return fallbackIso;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? fallbackIso : new Date(t).toISOString();
}

function verseKeyOf(value) {
  const key = String(value || "").trim();
  return /^\d{1,3}:\d{1,3}$/.test(key) ? key : null;
}

/**
 * Log a reading entry from the "My reading" page.
 *  - entry_type 'surah'   → a "Last read" mark (surah + optional ayah + when).
 *  - entry_type 'session' → a timed reading session (minutes + when).
 */
export async function logReading(formData) {
  const session = await requireSession();
  const entryType = String(formData.get("entry_type") || "");
  const db = getDb();
  const now = new Date().toISOString();
  const readAt = normaliseReadAt(formData.get("read_at"), now);

  if (entryType === "surah") {
    const surahNumber = Number(formData.get("surah_number"));
    if (!surahNumber) return;
    const verseKey = verseKeyOf(formData.get("verse_key"));
    db.prepare(`
      INSERT INTO reading_entries (id, teacher_id, entry_type, surah_number, surah_name, verse_key, created_at, read_at)
      VALUES (?, ?, 'surah', ?, ?, ?, ?, ?)
    `).run(randomUUID(), session.userId, surahNumber, surahByNumber(surahNumber)?.name ?? `Surah ${surahNumber}`, verseKey, now, readAt);
  } else if (entryType === "session") {
    const minutes = Number(formData.get("session_minutes"));
    if (!minutes || minutes <= 0) return;
    db.prepare(`
      INSERT INTO reading_entries (id, teacher_id, entry_type, session_minutes, created_at, read_at)
      VALUES (?, ?, 'session', ?, ?, ?)
    `).run(randomUUID(), session.userId, minutes, now, readAt);
  }

  revalidatePath("/reading");
  revalidatePath("/dashboard");
}

/**
 * Append a "Last read" entry straight from the Quran reader. Called by the
 * reader store when the teacher has the "Log my place to My reading" toggle on
 * and bookmarks an ayah, so their reading follows them onto the My reading page.
 */
export async function logLastReadFromReader({ chapterId, verseKey }) {
  const session = await requireSession();
  const cid = Number(chapterId);
  const key = verseKeyOf(verseKey);
  if (!Number.isInteger(cid) || cid < 1 || cid > 114) return;

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO reading_entries (id, teacher_id, entry_type, surah_number, surah_name, verse_key, created_at, read_at)
    VALUES (?, ?, 'surah', ?, ?, ?, ?, ?)
  `).run(randomUUID(), session.userId, cid, surahByNumber(cid)?.name ?? `Surah ${cid}`, key, now, now);

  revalidatePath("/reading");
  revalidatePath("/dashboard");
}

/** Edit an existing reading entry (owner only) — chiefly its date/time. */
export async function updateReadingEntry(formData) {
  const session = await requireSession();
  const id = String(formData.get("id") || "");
  if (!id) return;

  const db = getDb();
  const entry = db.prepare("SELECT * FROM reading_entries WHERE id = ? AND teacher_id = ?").get(id, session.userId);
  if (!entry) return;

  const readAt = normaliseReadAt(formData.get("read_at"), entry.read_at || entry.created_at);

  if (entry.entry_type === "surah") {
    const surahNumber = Number(formData.get("surah_number")) || entry.surah_number;
    const verseKey = formData.has("verse_key") ? verseKeyOf(formData.get("verse_key")) : entry.verse_key;
    db.prepare(`
      UPDATE reading_entries SET surah_number = ?, surah_name = ?, verse_key = ?, read_at = ? WHERE id = ?
    `).run(surahNumber, surahByNumber(surahNumber)?.name ?? `Surah ${surahNumber}`, verseKey, readAt, id);
  } else {
    const minutes = Number(formData.get("session_minutes")) || entry.session_minutes;
    db.prepare("UPDATE reading_entries SET session_minutes = ?, read_at = ? WHERE id = ?").run(minutes, readAt, id);
  }

  revalidatePath("/reading");
  revalidatePath("/dashboard");
}

export async function deleteReadingEntry(id) {
  const session = await requireSession();
  const entryId = String(id || "");
  if (!entryId) return;
  const db = getDb();
  db.prepare("DELETE FROM reading_entries WHERE id = ? AND teacher_id = ?").run(entryId, session.userId);
  revalidatePath("/reading");
  revalidatePath("/dashboard");
}

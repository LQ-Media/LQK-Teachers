"use server";

import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";

/**
 * Quran bookmark backend for the Teachers Portal.
 *
 * This is the portal-native replacement for the Shopify storefront's
 * customer-metafield + App Proxy + Cloudflare Worker flow. Here the canonical
 * store is the portal's SQLite database, keyed by the logged-in teacher, so
 * "continue reading" follows the teacher across every device they log in on —
 * exactly the cross-device guarantee, with no external infrastructure.
 *
 * Server Functions are reachable via direct POST, so — as the Next.js docs
 * require — every export verifies the session before touching data.
 */

export async function getQuranBookmark() {
  const session = await requireSession();
  const db = getDb();
  const row = db
    .prepare("SELECT chapter_id, verse_key FROM quran_bookmarks WHERE teacher_id = ?")
    .get(session.userId);
  if (!row) return null;
  return { chapterId: row.chapter_id, verseKey: row.verse_key };
}

export async function setQuranBookmark({ chapterId, verseKey }) {
  const session = await requireSession();

  const cid = Number(chapterId);
  const key = String(verseKey || "");
  if (!Number.isInteger(cid) || cid < 1 || cid > 114 || !/^\d{1,3}:\d{1,3}$/.test(key)) {
    throw new Error("Invalid bookmark");
  }

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO quran_bookmarks (teacher_id, chapter_id, verse_key, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(teacher_id) DO UPDATE SET
       chapter_id = excluded.chapter_id,
       verse_key = excluded.verse_key,
       updated_at = excluded.updated_at`
  ).run(session.userId, cid, key, now);
}

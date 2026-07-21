"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession, requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { surahName } from "@/lib/surahs";

export async function submitHafalan(formData) {
  const session = await requireSession();
  const surahNumber = Number(formData.get("surah_number"));
  const rating = String(formData.get("rating") || "");
  const note = String(formData.get("note") || "").trim() || null;
  const resubmitOf = formData.get("resubmit_of");

  if (!surahNumber || !["lancar", "mutqin", "needs_review"].includes(rating)) {
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO hafalan_entries (id, teacher_id, surah_number, surah_name, rating, note, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(randomUUID(), session.userId, surahNumber, surahName(surahNumber), rating, note, now, now);

  if (resubmitOf) {
    // Original rejected entry stays visible as history; nothing else to update.
  }

  revalidatePath("/hafalan");
  revalidatePath("/dashboard");
}

export async function approveHafalan(formData) {
  const session = await requireRole(["reviewer", "admin"]);
  const entryId = String(formData.get("entry_id"));

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE hafalan_entries
    SET status = 'approved', reviewer_id = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(session.userId, now, now, entryId);

  revalidatePath("/review");
  revalidatePath("/dashboard");
}

export async function rejectHafalan(formData) {
  const session = await requireRole(["reviewer", "admin"]);
  const entryId = String(formData.get("entry_id"));
  const reviewerNote = String(formData.get("reviewer_note") || "").trim();

  if (!reviewerNote) return;

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE hafalan_entries
    SET status = 'rejected', reviewer_id = ?, reviewer_note = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(session.userId, reviewerNote, now, now, entryId);

  revalidatePath("/review");
  revalidatePath("/dashboard");
}

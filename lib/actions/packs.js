"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession, requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { analyseRange } from "@/lib/packs/analyse";
import { generateLessonPack } from "@/lib/ai/provider";
import { AGE_GROUPS, isAgeGroup, ageLabel } from "@/lib/notes/taxonomy";

/**
 * Build (or rebuild) a pack for a portion. Reviewer/admin only — generation
 * costs a model call and lands as a DRAFT, so nobody can push an unreviewed
 * plan in front of a class.
 */
export async function generatePack(formData) {
  const session = await requireRole(["reviewer", "admin"]);

  const surah = Number(formData.get("surah"));
  const fromAyah = Number(formData.get("from_ayah"));
  const toAyah = Number(formData.get("to_ayah"));
  const ageGroup = isAgeGroup(formData.get("age_group")) ? String(formData.get("age_group")) : "all";

  if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
    return { ok: false, error: "Choose a surah." };
  }

  const analysed = await analyseRange({ surah, fromAyah, toAyah });
  if (!analysed.ok) return analysed;
  const { analysis } = analysed;

  const generated = await generateLessonPack({ analysis, ageGroupLabel: ageLabel(ageGroup) });
  if (!generated.ok) return generated;

  const db = getDb();
  const now = new Date().toISOString();

  // Regenerating an existing portion replaces the draft and sends it back for
  // review — an approved pack must never silently change under a teacher.
  const existing = db
    .prepare("SELECT id FROM lesson_packs WHERE surah = ? AND from_ayah = ? AND to_ayah = ? AND age_group = ?")
    .get(analysis.surah, analysis.fromAyah, analysis.toAyah, ageGroup);

  const id = existing?.id || randomUUID();
  const payload = [
    analysis.label,
    JSON.stringify(analysis.rules),
    JSON.stringify(analysis.ayat),
    JSON.stringify(generated.pack),
    now,
  ];

  if (existing) {
    db.prepare(
      `UPDATE lesson_packs SET label = ?, tajweed = ?, ayat = ?, content = ?, updated_at = ?,
       status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = ?`
    ).run(...payload, id);
  } else {
    db.prepare(
      `INSERT INTO lesson_packs (id, surah, from_ayah, to_ayah, age_group, label, tajweed, ayat, content,
       status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    ).run(
      id,
      analysis.surah,
      analysis.fromAyah,
      analysis.toAyah,
      ageGroup,
      analysis.label,
      JSON.stringify(analysis.rules),
      JSON.stringify(analysis.ayat),
      JSON.stringify(generated.pack),
      session.userId,
      now,
      now
    );
  }

  revalidatePath("/packs");
  revalidatePath(`/packs/${id}`);
  return { ok: true, id };
}

/** Approve a draft so teachers can see it. Reviewer/admin only. */
export async function approvePack(packId) {
  const session = await requireRole(["reviewer", "admin"]);
  const id = String(packId || "");
  if (!id) return { ok: false, error: "Missing pack." };

  getDb()
    .prepare("UPDATE lesson_packs SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?")
    .run(session.userId, new Date().toISOString(), new Date().toISOString(), id);

  revalidatePath("/packs");
  revalidatePath(`/packs/${id}`);
  return { ok: true };
}

/** Send an approved pack back to draft (e.g. a mistake was spotted in class). */
export async function unapprovePack(packId) {
  await requireRole(["reviewer", "admin"]);
  const id = String(packId || "");
  if (!id) return { ok: false, error: "Missing pack." };

  getDb()
    .prepare("UPDATE lesson_packs SET status = 'draft', approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);

  revalidatePath("/packs");
  revalidatePath(`/packs/${id}`);
  return { ok: true };
}

export async function deletePack(packId) {
  await requireRole(["reviewer", "admin"]);
  const id = String(packId || "");
  if (!id) return { ok: false };
  getDb().prepare("DELETE FROM lesson_packs WHERE id = ?").run(id);
  revalidatePath("/packs");
  return { ok: true };
}

/**
 * Preview what a portion contains before spending a generation on it — pure
 * mushaf data, no model call, so this is free to click.
 */
export async function previewRange(formData) {
  await requireSession();
  const result = await analyseRange({
    surah: Number(formData.get("surah")),
    fromAyah: Number(formData.get("from_ayah")),
    toAyah: Number(formData.get("to_ayah")),
  });
  return result;
}

export async function ageGroupOptions() {
  return AGE_GROUPS;
}

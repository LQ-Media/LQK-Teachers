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

// ---- Teacher proposals (skill 12) --------------------------------------
//
// A teacher cannot edit an approved pack — every branch teaches the same plan,
// and that consistency is the point. What they can do is propose a change to
// one section with a reason. A reviewer approves (which applies it) or
// declines. The proposal row stays either way: it is what criterion A4 of the
// peer assessment is scored from.

// Not exported: a "use server" module may only export async functions. The
// client keeps its own copy in components/packs/PackEdits.js.
const PACK_EDIT_SECTIONS = {
  objective: "By the end (objective)",
  hook: "Opening",
  activity: "One step in the run of the lesson",
  parentNote: "Note home to parents",
  note: "A teacher's note on the pack",
};

function packContent(row) {
  try {
    const c = JSON.parse(row.content ?? "null");
    return c && typeof c === "object" ? c : {};
  } catch {
    return {};
  }
}

export async function proposePackEdit(input) {
  const session = await requireSession();
  const db = getDb();
  const packId = String(input?.packId || "");
  const section = String(input?.section || "");
  const proposed = String(input?.proposed || "").trim().slice(0, 2000);
  const reason = String(input?.reason || "").trim().slice(0, 600);
  const activityIndex = section === "activity" ? Number(input?.activityIndex) : null;

  const pack = db.prepare("SELECT id, status, content FROM lesson_packs WHERE id = ?").get(packId);
  if (!pack) return { ok: false, error: "That pack no longer exists." };
  if (!Object.prototype.hasOwnProperty.call(PACK_EDIT_SECTIONS, section)) return { ok: false, error: "Choose which part to change." };
  if (!proposed) return { ok: false, error: "Write the change you are proposing." };
  if (!reason) return { ok: false, error: "Say why — what happened in class that showed it was needed." };
  if (section === "activity") {
    const acts = Array.isArray(packContent(pack).activities) ? packContent(pack).activities : [];
    if (!Number.isInteger(activityIndex) || activityIndex < 0 || activityIndex >= acts.length) {
      return { ok: false, error: "Choose which step of the lesson." };
    }
  }

  db.prepare(
    `INSERT INTO lesson_pack_edits (id, pack_id, proposer_id, section, activity_index, proposed, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(randomUUID(), packId, session.userId, section, activityIndex, proposed, reason, new Date().toISOString());

  revalidatePath("/packs");
  revalidatePath(`/packs/${packId}`);
  return { ok: true };
}

/**
 * Reviewer decides. Approving APPLIES the change to the pack's content and
 * stamps updated_at, so the next teacher to open it teaches the new wording.
 * The pack stays approved: a reviewer read the proposal, that is the review.
 */
export async function decidePackEdit(input) {
  const session = await requireRole(["reviewer", "admin"]);
  const db = getDb();
  const id = String(input?.id || "");
  const decision = input?.decision === "approved" ? "approved" : input?.decision === "declined" ? "declined" : null;
  const note = String(input?.note || "").trim().slice(0, 600);
  if (!decision) return { ok: false, error: "Approve or decline." };

  const edit = db.prepare("SELECT * FROM lesson_pack_edits WHERE id = ? AND status = 'pending'").get(id);
  if (!edit) return { ok: false, error: "That proposal has already been decided." };
  const pack = db.prepare("SELECT id, content FROM lesson_packs WHERE id = ?").get(edit.pack_id);
  if (!pack) return { ok: false, error: "The pack no longer exists." };

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    if (decision === "approved") {
      const content = packContent(pack);
      if (edit.section === "activity") {
        const acts = Array.isArray(content.activities) ? content.activities : [];
        if (acts[edit.activity_index]) acts[edit.activity_index] = { ...acts[edit.activity_index], how: edit.proposed };
        content.activities = acts;
      } else if (edit.section === "note") {
        const notes = Array.isArray(content.teacherNotes) ? content.teacherNotes : [];
        notes.push(edit.proposed);
        content.teacherNotes = notes;
      } else {
        content[edit.section] = edit.proposed;
      }
      db.prepare("UPDATE lesson_packs SET content = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(content), now, pack.id);
    }
    db.prepare(
      "UPDATE lesson_pack_edits SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?"
    ).run(decision, session.userId, now, note || null, id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { ok: false, error: err.message };
  }

  revalidatePath("/packs");
  revalidatePath(`/packs/${pack.id}`);
  return { ok: true };
}

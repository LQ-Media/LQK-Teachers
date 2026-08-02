"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { summariseNote } from "@/lib/ai/provider";

const SOURCES = ["recording", "photo", "typed"];
const MAX_RAW_CHARS = 200_000;

function text(formData, key, max = 200) {
  return String(formData.get(key) || "").trim().slice(0, max);
}

/** YYYY-MM-DD in Singapore, used as the default "when did this happen". */
export function sgToday() {
  const now = new Date();
  const sg = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  return `${sg.getFullYear()}-${String(sg.getMonth() + 1).padStart(2, "0")}-${String(sg.getDate()).padStart(2, "0")}`;
}

function dateOr(value, fallback) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

/**
 * Save a note and, when the summariser is configured, summarise it in the same
 * call. A summariser failure never loses the note — the row is written first,
 * and the failure comes back as a warning the teacher can retry from the note
 * page. The raw text is what matters; the summary is a convenience on top.
 */
export async function createNote(formData) {
  const session = await requireSession();

  const raw = String(formData.get("raw_text") || "").trim().slice(0, MAX_RAW_CHARS);
  if (!raw) return { ok: false, error: "There is nothing to save yet." };

  const source = SOURCES.includes(formData.get("source")) ? String(formData.get("source")) : "typed";
  const speaker = text(formData, "speaker", 120);
  const venue = text(formData, "venue", 120);
  const occurredOn = dateOr(formData.get("occurred_on"), sgToday());
  const language = text(formData, "language", 8) || "auto";
  const wantsSummary = formData.get("summarise") !== "0";

  const id = randomUUID();
  const now = new Date().toISOString();
  const db = getDb();

  // Provisional title — replaced by the summariser's title when we get one.
  const fallbackTitle = text(formData, "title", 160) || firstLine(raw);

  db.prepare(
    `INSERT INTO notes (id, teacher_id, title, source, speaker, venue, occurred_on, language, raw_text, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(id, session.userId, fallbackTitle, source, speaker || null, venue || null, occurredOn, language, raw, now, now);

  let warning = null;
  if (wantsSummary) {
    const result = await runSummary({ db, id, raw, speaker, venue, userTitle: text(formData, "title", 160) });
    if (!result.ok) warning = result.error;
  }

  revalidatePath("/notebook");
  return { ok: true, id, warning };
}

/** Re-run the summariser on an existing note (owner only). */
export async function summariseExistingNote(noteId) {
  const session = await requireSession();
  const id = String(noteId || "");
  if (!id) return { ok: false, error: "Missing note." };

  const db = getDb();
  const note = db.prepare("SELECT * FROM notes WHERE id = ? AND teacher_id = ?").get(id, session.userId);
  if (!note) return { ok: false, error: "Note not found." };

  const result = await runSummary({
    db,
    id,
    raw: note.raw_text || "",
    speaker: note.speaker || "",
    venue: note.venue || "",
    userTitle: "",
  });

  revalidatePath("/notebook");
  revalidatePath(`/notebook/${id}`);
  return result;
}

/** Shared summarise-then-persist step. Returns { ok } or { ok:false, error }. */
async function runSummary({ db, id, raw, speaker, venue, userTitle }) {
  const hintParts = [];
  if (speaker) hintParts.push(`The speaker was ${speaker}.`);
  if (venue) hintParts.push(`It took place at ${venue}.`);

  const result = await summariseNote({ text: raw, hint: hintParts.join(" ") });
  if (!result.ok) return result;

  // A title the teacher typed themselves always wins over the generated one.
  const title = userTitle || result.summary.title || firstLine(raw);
  db.prepare("UPDATE notes SET title = ?, summary = ?, updated_at = ? WHERE id = ?").run(
    title,
    JSON.stringify(result.summary),
    new Date().toISOString(),
    id
  );
  return { ok: true };
}

/** Edit a note's own details. Editing the source text clears the stale summary. */
export async function updateNote(formData) {
  const session = await requireSession();
  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, error: "Missing note." };

  const db = getDb();
  const note = db.prepare("SELECT * FROM notes WHERE id = ? AND teacher_id = ?").get(id, session.userId);
  if (!note) return { ok: false, error: "Note not found." };

  const title = text(formData, "title", 160) || note.title;
  const speaker = text(formData, "speaker", 120);
  const venue = text(formData, "venue", 120);
  const occurredOn = dateOr(formData.get("occurred_on"), note.occurred_on);
  const raw = formData.has("raw_text")
    ? String(formData.get("raw_text") || "").trim().slice(0, MAX_RAW_CHARS)
    : note.raw_text;

  // If the source text changed, the existing summary no longer describes it.
  const summary = raw === note.raw_text ? note.summary : null;

  db.prepare(
    `UPDATE notes SET title = ?, speaker = ?, venue = ?, occurred_on = ?, raw_text = ?, summary = ?, updated_at = ?
     WHERE id = ? AND teacher_id = ?`
  ).run(title, speaker || null, venue || null, occurredOn, raw, summary, new Date().toISOString(), id, session.userId);

  revalidatePath("/notebook");
  revalidatePath(`/notebook/${id}`);
  return { ok: true, summaryCleared: summary === null && note.summary !== null };
}

export async function deleteNote(noteId) {
  const session = await requireSession();
  const id = String(noteId || "");
  if (!id) return { ok: false };
  const db = getDb();
  db.prepare("DELETE FROM notes WHERE id = ? AND teacher_id = ?").run(id, session.userId);
  revalidatePath("/notebook");
  return { ok: true };
}

function firstLine(raw) {
  const line = String(raw || "").split("\n").find((l) => l.trim()) || "Untitled note";
  return line.trim().slice(0, 80);
}

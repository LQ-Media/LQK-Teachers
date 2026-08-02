"use server";

import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireSession, requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { sgToday, sgMonthNow } from "@/lib/hours/rates";
import { HEARTBEAT_SECONDS, MAX_SECONDS_PER_DAY } from "@/lib/achievements/points";
import { CERT_DIR, MAX_CERT_BYTES, CERT_EXT_BY_TYPE } from "@/lib/certs";

function clean(v, max = 200) {
  return String(v ?? "").trim().slice(0, max);
}

// ---- Reading activity (streaks) ---------------------------------------

/**
 * Credit one heartbeat of reading time to today. Called by the Quran reader
 * roughly every HEARTBEAT_SECONDS while its tab is visible.
 *
 * The server decides how much a beat is worth (never the client) and caps the
 * day, so a tampered-with or looping client cannot inflate a streak. Returns the
 * day's running total so the UI can show it if it ever wants to.
 */
export async function recordReadingHeartbeat() {
  const session = await requireSession();
  const db = getDb();
  const today = sgToday();
  const now = new Date().toISOString();

  const row = db
    .prepare("SELECT seconds FROM reader_activity WHERE teacher_id = ? AND date = ?")
    .get(session.userId, today);

  if (!row) {
    db.prepare(
      "INSERT INTO reader_activity (teacher_id, date, seconds, updated_at) VALUES (?, ?, ?, ?)"
    ).run(session.userId, today, HEARTBEAT_SECONDS, now);
    return { seconds: HEARTBEAT_SECONDS };
  }

  const seconds = Math.min(MAX_SECONDS_PER_DAY, row.seconds + HEARTBEAT_SECONDS);
  db.prepare("UPDATE reader_activity SET seconds = ?, updated_at = ? WHERE teacher_id = ? AND date = ?").run(
    seconds,
    now,
    session.userId,
    today
  );
  return { seconds };
}

// ---- Certificates -----------------------------------------------------

/** Upload a certificate for admin approval. */
export async function uploadCertificate(prevState, formData) {
  const session = await requireSession();
  const db = getDb();

  const typeId = clean(formData.get("cert_type_id"), 64);
  const type = typeId ? db.prepare("SELECT id, name FROM cert_types WHERE id = ? AND active = 1").get(typeId) : null;
  if (!type) return { error: "Choose which certificate this is." };

  const file = formData.get("image");
  if (!file || typeof file === "string" || file.size === 0) {
    return { error: "Attach a photo or scan of the certificate." };
  }
  const ext = CERT_EXT_BY_TYPE[file.type];
  if (!ext) return { error: "Use a JPEG, PNG, WebP, or PDF file." };
  if (file.size > MAX_CERT_BYTES) return { error: "That file is larger than 8 MB." };

  const issuer = clean(formData.get("issuer"), 120);
  const issuedOn = /^\d{4}-\d{2}-\d{2}$/.test(clean(formData.get("issued_on"), 10))
    ? clean(formData.get("issued_on"), 10)
    : null;

  if (!existsSync(CERT_DIR)) mkdirSync(CERT_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  writeFileSync(path.join(CERT_DIR, filename), Buffer.from(await file.arrayBuffer()));

  db.prepare(
    `INSERT INTO certifications
       (id, teacher_id, cert_type_id, cert_name, issuer, issued_on, image_path, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(randomUUID(), session.userId, type.id, type.name, issuer, issuedOn, filename, new Date().toISOString());

  revalidatePath("/achievements");
  return { ok: true };
}

/** Withdraw one of your own certificate submissions (only while pending). */
export async function deleteCertificate(id) {
  const session = await requireSession();
  const db = getDb();
  const cert = db.prepare("SELECT id, teacher_id, image_path, status FROM certifications WHERE id = ?").get(String(id));
  if (!cert) return { error: "Not found." };
  const isOwner = cert.teacher_id === session.userId;
  if (!isOwner && session.role !== "admin") return { error: "Not allowed." };
  if (isOwner && session.role !== "admin" && cert.status !== "pending") {
    return { error: "An approved certificate can only be removed by an admin." };
  }

  try {
    rmSync(path.join(CERT_DIR, cert.image_path));
  } catch {
    /* best-effort: the row goes either way */
  }
  db.prepare("DELETE FROM certifications WHERE id = ?").run(cert.id);
  revalidatePath("/achievements");
  return { ok: true };
}

/** Admin: approve or reject a submitted certificate. */
export async function reviewCertificate({ id, decision, note }) {
  const session = await requireRole(["admin"]);
  if (!["approved", "rejected"].includes(decision)) return { error: "Unknown decision." };
  const db = getDb();
  const cert = db.prepare("SELECT id FROM certifications WHERE id = ?").get(String(id));
  if (!cert) return { error: "Not found." };

  db.prepare(
    "UPDATE certifications SET status = ?, reviewer_id = ?, reviewer_note = ?, reviewed_at = ? WHERE id = ?"
  ).run(decision, session.userId, clean(note, 300) || null, new Date().toISOString(), cert.id);

  revalidatePath("/achievements");
  return { ok: true };
}

/** Admin: maintain the recognised-certificate catalogue. */
export async function createCertType({ name, description }) {
  await requireRole(["admin"]);
  const db = getDb();
  const clean_ = clean(name, 80);
  if (!clean_) return { error: "Give the certificate a name." };
  const dupe = db.prepare("SELECT id FROM cert_types WHERE name = ?").get(clean_);
  if (dupe) return { error: "That certificate already exists." };
  db.prepare(
    "INSERT INTO cert_types (id, name, description, active, created_at) VALUES (?, ?, ?, 1, ?)"
  ).run(randomUUID(), clean_, clean(description, 200) || null, new Date().toISOString());
  revalidatePath("/achievements");
  return { ok: true };
}

export async function setCertTypeActive({ id, active }) {
  await requireRole(["admin"]);
  getDb()
    .prepare("UPDATE cert_types SET active = ? WHERE id = ?")
    .run(active ? 1 : 0, String(id));
  revalidatePath("/achievements");
  return { ok: true };
}

// ---- Honours ----------------------------------------------------------

/**
 * Admin: award an honour. A 'monthly' title has one holder per month, so
 * awarding a new one replaces the existing holder for that month.
 */
export async function awardHonour({ teacherId, kind, title, reason, month }) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  if (!["monthly", "oneoff"].includes(kind)) return { error: "Unknown honour type." };

  const who = db.prepare("SELECT id FROM profiles WHERE id = ?").get(String(teacherId));
  if (!who) return { error: "Choose who this is for." };
  const t = clean(title, 80);
  if (!t) return { error: "Give the honour a title." };

  const m = kind === "monthly" ? (/^\d{4}-\d{2}$/.test(clean(month, 7)) ? clean(month, 7) : sgMonthNow()) : null;
  if (kind === "monthly") {
    db.prepare("DELETE FROM honours WHERE kind = 'monthly' AND month = ?").run(m);
  }

  db.prepare(
    `INSERT INTO honours (id, teacher_id, kind, title, reason, month, awarded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), who.id, kind, t, clean(reason, 300) || null, m, session.userId, new Date().toISOString());

  revalidatePath("/achievements");
  return { ok: true };
}

export async function deleteHonour(id) {
  await requireRole(["admin"]);
  getDb().prepare("DELETE FROM honours WHERE id = ?").run(String(id));
  revalidatePath("/achievements");
  return { ok: true };
}

// ---- Nominations ------------------------------------------------------

/** Nominate a colleague. One nomination per person per month, and not yourself. */
export async function nominateColleague({ nomineeId, reason }) {
  const session = await requireSession();
  const db = getDb();
  const id = String(nomineeId || "");
  if (!id) return { error: "Choose a colleague." };
  if (id === session.userId) return { error: "Nominate a colleague, not yourself." };
  const who = db.prepare("SELECT id FROM profiles WHERE id = ?").get(id);
  if (!who) return { error: "That person no longer has an account." };
  const why = clean(reason, 300);
  if (why.length < 10) return { error: "Say a little about why — at least a sentence." };

  const month = sgMonthNow();
  const existing = db
    .prepare("SELECT id FROM nominations WHERE nominator_id = ? AND month = ?")
    .get(session.userId, month);
  if (existing) return { error: "You've already nominated someone this month." };

  db.prepare(
    `INSERT INTO nominations (id, nominee_id, nominator_id, reason, month, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run(randomUUID(), id, session.userId, why, month, new Date().toISOString());

  revalidatePath("/achievements");
  return { ok: true };
}

/** Admin: confirm or decline a nomination. */
export async function reviewNomination({ id, decision }) {
  await requireRole(["admin"]);
  if (!["confirmed", "declined"].includes(decision)) return { error: "Unknown decision." };
  getDb()
    .prepare("UPDATE nominations SET status = ?, reviewed_at = ? WHERE id = ?")
    .run(decision, new Date().toISOString(), String(id));
  revalidatePath("/achievements");
  return { ok: true };
}

// ---- Roster linking ---------------------------------------------------

/**
 * Admin: link (or unlink) a roster row to a login account. Without this a staff
 * member's own lessons cannot be credited to their account — see the note on
 * students.profile_id in lib/db.js.
 */
export async function linkRosterToAccount({ studentId, profileId }) {
  await requireRole(["admin"]);
  const db = getDb();
  const sid = Number(studentId);
  const student = db.prepare("SELECT id FROM students WHERE id = ?").get(sid);
  if (!student) return { error: "Staff member not found." };

  const pid = String(profileId || "");
  if (!pid) {
    db.prepare("UPDATE students SET profile_id = NULL WHERE id = ?").run(sid);
    revalidatePath("/achievements");
    return { ok: true };
  }

  const profile = db.prepare("SELECT id FROM profiles WHERE id = ?").get(pid);
  if (!profile) return { error: "That account no longer exists." };

  // One account per roster row: linking an account that is already claimed
  // elsewhere would double-count that person's hafalan.
  const taken = db.prepare("SELECT id, name FROM students WHERE profile_id = ? AND id != ?").get(pid, sid);
  if (taken) return { error: `That account is already linked to ${taken.name}.` };

  db.prepare("UPDATE students SET profile_id = ? WHERE id = ?").run(pid, sid);
  revalidatePath("/achievements");
  return { ok: true };
}

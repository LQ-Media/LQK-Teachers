"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getDb, LOCATIONS, TRACKER_CLASSES } from "@/lib/db";
import { hashPassword } from "@/lib/hash";

const ROLES = ["teacher", "reviewer", "admin"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A short, human-shareable temporary password. The account is flagged
// must_change_password, so it is only ever used once at first login.
function genTempPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous 0/o/1/l
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `lqk-${s}`;
}

function clean(v) {
  return String(v || "").trim();
}

function rebuildLocations(db, teacherId, branches, primary) {
  const set = new Set((branches || []).map(clean).filter(Boolean));
  if (primary) set.add(clean(primary));
  db.prepare("DELETE FROM teacher_locations WHERE teacher_id = ?").run(teacherId);
  const ins = db.prepare(
    "INSERT OR IGNORE INTO teacher_locations (id, teacher_id, location, is_primary) VALUES (?, ?, ?, ?)"
  );
  for (const loc of set) ins.run(randomUUID(), teacherId, loc, loc === clean(primary) ? 1 : 0);
}

// ---- Users (login accounts) --------------------------------------------

export async function createUser(data) {
  await requireRole(["admin"]);
  const db = getDb();

  const full_name = clean(data.full_name);
  const email = clean(data.email).toLowerCase();
  const role = ROLES.includes(data.role) ? data.role : "teacher";
  const primary_location = clean(data.primary_location);
  const position = clean(data.position);
  const branches = Array.isArray(data.branches) ? data.branches : [];

  if (!full_name) return { error: "Name is required." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (db.prepare("SELECT 1 FROM profiles WHERE email = ?").get(email)) {
    return { error: "An account with that email already exists." };
  }

  const id = randomUUID();
  const tempPassword = genTempPassword();
  db.prepare(
    `INSERT INTO profiles (id, full_name, email, password_hash, role, primary_location, position, photo, must_change_password, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`
  ).run(id, full_name, email, hashPassword(tempPassword), role, primary_location || null, position || null, new Date().toISOString());
  rebuildLocations(db, id, branches, primary_location);

  revalidatePath("/admin");
  return { ok: true, tempPassword, email };
}

export async function updateUser(data) {
  await requireRole(["admin"]);
  const db = getDb();

  const id = clean(data.id);
  const full_name = clean(data.full_name);
  const email = clean(data.email).toLowerCase();
  const role = ROLES.includes(data.role) ? data.role : "teacher";
  const primary_location = clean(data.primary_location);
  const position = clean(data.position);
  const branches = Array.isArray(data.branches) ? data.branches : [];

  const existing = db.prepare("SELECT id FROM profiles WHERE id = ?").get(id);
  if (!existing) return { error: "Account not found." };
  if (!full_name) return { error: "Name is required." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  const clash = db.prepare("SELECT 1 FROM profiles WHERE email = ? AND id != ?").get(email, id);
  if (clash) return { error: "Another account already uses that email." };

  db.prepare(
    "UPDATE profiles SET full_name = ?, email = ?, role = ?, primary_location = ?, position = ? WHERE id = ?"
  ).run(full_name, email, role, primary_location || null, position || null, id);
  rebuildLocations(db, id, branches, primary_location);

  revalidatePath("/admin");
  return { ok: true };
}

export async function resetUserPassword(id) {
  await requireRole(["admin"]);
  const db = getDb();
  const uid = clean(id);
  const user = db.prepare("SELECT email FROM profiles WHERE id = ?").get(uid);
  if (!user) return { error: "Account not found." };

  const tempPassword = genTempPassword();
  db.prepare("UPDATE profiles SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(
    hashPassword(tempPassword),
    uid
  );
  revalidatePath("/admin");
  return { ok: true, tempPassword, email: user.email };
}

export async function deleteUser(id) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const uid = clean(id);
  if (uid === session.userId) return { error: "You can’t delete your own account." };
  db.prepare("DELETE FROM profiles WHERE id = ?").run(uid);
  revalidatePath("/admin");
  return { ok: true };
}

// ---- Staff roster (the monitored teaching staff = `students`) -----------

export async function createStudent(data) {
  await requireRole(["admin"]);
  const db = getDb();

  const name = clean(data.name);
  const cls = TRACKER_CLASSES.includes(data.class) ? data.class : null;
  const position = clean(data.position);
  const juz = Math.max(1, Math.min(30, Number(data.juz) || 1));

  if (!name) return { error: "Name is required." };
  if (!cls) return { error: "Choose a branch." };

  const { max } = db.prepare("SELECT MAX(id) AS max FROM students").get();
  const id = (max || 0) + 1;
  db.prepare(
    "INSERT INTO students (id, name, class, juz, position, photo, created_at) VALUES (?, ?, ?, ?, ?, '', ?)"
  ).run(id, name, cls, juz, position, new Date().toISOString());

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateStudent(data) {
  await requireRole(["admin"]);
  const db = getDb();

  const id = Number(data.id);
  const name = clean(data.name);
  const cls = TRACKER_CLASSES.includes(data.class) ? data.class : null;
  const position = clean(data.position);
  const juz = Math.max(1, Math.min(30, Number(data.juz) || 1));

  const existing = db.prepare("SELECT class FROM students WHERE id = ?").get(id);
  if (!existing) return { error: "Staff member not found." };
  if (!name) return { error: "Name is required." };
  if (!cls) return { error: "Choose a branch." };

  db.prepare("UPDATE students SET name = ?, class = ?, juz = ?, position = ? WHERE id = ?").run(
    name,
    cls,
    juz,
    position,
    id
  );

  // Branch reassignment moves their history with them: past lessons follow the
  // staff member to the new branch (chosen behaviour), so their record stays whole.
  if (existing.class !== cls) {
    db.prepare("UPDATE lessons SET class = ? WHERE student_id = ?").run(cls, id);
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, movedHistory: existing.class !== cls };
}

export async function deleteStudent(id) {
  await requireRole(["admin"]);
  const db = getDb();
  db.prepare("DELETE FROM students WHERE id = ?").run(Number(id));
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true };
}

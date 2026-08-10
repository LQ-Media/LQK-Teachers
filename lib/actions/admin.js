"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getDb, LOCATIONS, TRACKER_CLASSES } from "@/lib/db";
import { hashPassword } from "@/lib/hash";
import { attachToRoster } from "@/lib/roster";
import { TIER_BY_KEY, sgToday } from "@/lib/hours/rates";

const ROLES = ["teacher", "reviewer", "admin"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Accept a known pay-tier key, else null (unset).
function validTier(v) {
  const k = String(v || "").trim();
  return TIER_BY_KEY[k] ? k : null;
}

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

// A profile is referenced by rows that outlive the person — a lesson they
// logged, a certificate they reviewed, the roster row they are linked to. Those
// columns carry no ON DELETE clause, so SQLite refuses the delete until they
// are detached. Mirrors the list in scripts/reset-accounts.mjs.
const PROFILE_REFS = [
  ["students", "profile_id"],
  ["lessons", "teacher_id"],
  ["hafalan_entries", "reviewer_id"],
  ["work_sessions", "reviewer_id"],
  // Who inserted the session/shift, as opposed to who approved it. Both must be
  // detached or deleting the admin who rostered a term throws a foreign-key
  // error instead of deleting the account.
  ["work_sessions", "created_by"],
  ["shifts", "created_by"],
  ["shifts", "cancelled_by"],
  ["shifts", "resolved_by"],
  ["certifications", "reviewer_id"],
  ["honours", "awarded_by"],
  ["lesson_packs", "created_by"],
  ["lesson_packs", "approved_by"],
  ["invites", "invited_by"],
];

function detachProfileRefs(db, ids) {
  if (!ids.length) return;
  const holes = ids.map(() => "?").join(",");
  for (const [table, col] of PROFILE_REFS) {
    db.prepare(`UPDATE ${table} SET ${col} = NULL WHERE ${col} IN (${holes})`).run(...ids);
  }
}

/**
 * An account and its roster row are two halves of one person, so deleting the
 * account takes the roster entry with it — otherwise the roster fills up with
 * unclaimed rows for people who no longer exist. Their logged lessons and juz
 * milestones cascade from students.
 *
 * Lessons they *taught* against someone else's roster row are not theirs to
 * take: those survive with teacher_id detached (see PROFILE_REFS).
 *
 * Must run before the profiles delete, while profile_id still points at them.
 */
function deleteRosterRowsFor(db, ids) {
  if (!ids.length) return 0;
  const holes = ids.map(() => "?").join(",");
  return db.prepare(`DELETE FROM students WHERE profile_id IN (${holes})`).run(...ids).changes;
}

// Normalise an id list coming from the client: strings, no blanks, no repeats.
function idList(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(clean).filter(Boolean))];
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
  const pay_tier = validTier(data.pay_tier);
  const branches = Array.isArray(data.branches) ? data.branches : [];

  if (!full_name) return { error: "Name is required." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (db.prepare("SELECT 1 FROM profiles WHERE email = ?").get(email)) {
    return { error: "An account with that email already exists." };
  }

  const id = randomUUID();
  const tempPassword = genTempPassword();
  db.prepare(
    `INSERT INTO profiles (id, full_name, email, password_hash, role, primary_location, position, pay_tier, photo, must_change_password, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`
  ).run(id, full_name, email, hashPassword(tempPassword), role, primary_location || null, position || null, pay_tier, new Date().toISOString());
  rebuildLocations(db, id, branches, primary_location);

  // Every account belongs on the tracked roster, however it was created — the
  // same rule register() follows, so an admin-added user is never missing from
  // Staff roster.
  attachToRoster(db, { profileId: id, fullName: full_name, branch: primary_location, position });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
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
  const pay_tier = validTier(data.pay_tier);
  const branches = Array.isArray(data.branches) ? data.branches : [];

  const existing = db.prepare("SELECT id FROM profiles WHERE id = ?").get(id);
  if (!existing) return { error: "Account not found." };
  if (!full_name) return { error: "Name is required." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  const clash = db.prepare("SELECT 1 FROM profiles WHERE email = ? AND id != ?").get(email, id);
  if (clash) return { error: "Another account already uses that email." };

  db.prepare(
    "UPDATE profiles SET full_name = ?, email = ?, role = ?, primary_location = ?, position = ?, pay_tier = ? WHERE id = ?"
  ).run(full_name, email, role, primary_location || null, position || null, pay_tier, id);
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

  let rosterDeleted = 0;
  db.exec("BEGIN");
  try {
    rosterDeleted = deleteRosterRowsFor(db, [uid]);
    detachProfileRefs(db, [uid]);
    db.prepare("DELETE FROM profiles WHERE id = ?").run(uid);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { error: `Couldn’t delete that account — nothing was changed. ${err.message}` };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, rosterDeleted };
}

/**
 * Delete several accounts at once (Admin → Login accounts → select → Delete).
 *
 * Your own account is always filtered out rather than failing the whole batch,
 * so "select all → delete" does the obvious thing: everyone but you. The batch
 * is one transaction — either every selected account goes or none does.
 */
export async function deleteUsers(ids) {
  const session = await requireRole(["admin"]);
  const db = getDb();

  const requested = idList(ids);
  const targets = requested.filter((id) => id !== session.userId);
  const keptSelf = targets.length !== requested.length;

  if (!targets.length) {
    return { error: keptSelf ? "That only selected your own account, which you can’t delete." : "Nothing selected." };
  }

  const del = db.prepare("DELETE FROM profiles WHERE id = ?");
  let deleted = 0;
  let rosterDeleted = 0;
  db.exec("BEGIN");
  try {
    rosterDeleted = deleteRosterRowsFor(db, targets);
    detachProfileRefs(db, targets);
    for (const id of targets) deleted += del.run(id).changes;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { error: `Couldn’t delete those accounts — nothing was changed. ${err.message}` };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, deleted, rosterDeleted, keptSelf };
}

// ---- Invited emails (self-registration allowlist) ----------------------

export async function createInvite(data) {
  const session = await requireRole(["admin"]);
  const db = getDb();

  const email = clean(data.email).toLowerCase();
  const full_name = clean(data.full_name);
  const role = ROLES.includes(data.role) ? data.role : "teacher";
  const primary_location = clean(data.primary_location);
  const position = clean(data.position);
  const pay_tier = validTier(data.pay_tier);
  const branches = (Array.isArray(data.branches) ? data.branches : []).map(clean).filter(Boolean);

  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (db.prepare("SELECT 1 FROM profiles WHERE email = ?").get(email)) {
    return { error: "That email already has an account." };
  }
  if (db.prepare("SELECT 1 FROM invites WHERE email = ? AND used_at IS NULL").get(email)) {
    return { error: "That email is already invited." };
  }

  // A previously used invite for the same address is replaced, so re-inviting
  // someone whose account was deleted works.
  db.prepare("DELETE FROM invites WHERE email = ?").run(email);
  db.prepare(
    `INSERT INTO invites (id, email, full_name, role, primary_location, position, pay_tier, branches, invited_by, created_at, used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    randomUUID(),
    email,
    full_name || null,
    role,
    primary_location || null,
    position || null,
    pay_tier,
    JSON.stringify(branches),
    session.userId,
    new Date().toISOString()
  );

  revalidatePath("/admin");
  return { ok: true, email };
}

export async function deleteInvite(id) {
  await requireRole(["admin"]);
  getDb().prepare("DELETE FROM invites WHERE id = ?").run(clean(id));
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

  const existing = db.prepare("SELECT class, juz FROM students WHERE id = ?").get(id);
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

  // Moving someone's juz forward completes the juz (or juz) they were on. Stamp
  // each with today's date so the Achievements monthly season can credit it —
  // students.juz alone carries no history. See lib/achievements/score.js.
  const prevJuz = Number(existing.juz) || 1;
  if (juz > prevJuz) {
    const stamp = db.prepare(
      "INSERT INTO juz_milestones (id, student_id, juz, date, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const nowIso = new Date().toISOString();
    const today = sgToday();
    for (let j = prevJuz; j < juz; j++) stamp.run(randomUUID(), id, j, today, nowIso);
  }

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

/**
 * Remove several roster rows at once. Their lessons and juz milestones go with
 * them (ON DELETE CASCADE); the person's login account is untouched — the two
 * are separate records joined only by students.profile_id.
 */
export async function deleteStudents(ids) {
  await requireRole(["admin"]);
  const db = getDb();

  const targets = idList(ids)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  if (!targets.length) return { error: "Nothing selected." };

  const del = db.prepare("DELETE FROM students WHERE id = ?");
  let deleted = 0;
  db.exec("BEGIN");
  try {
    for (const id of targets) deleted += del.run(id).changes;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    return { error: `Couldn’t remove those roster rows — nothing was changed. ${err.message}` };
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, deleted };
}

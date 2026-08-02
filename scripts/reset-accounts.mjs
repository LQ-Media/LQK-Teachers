/**
 * Reset login accounts so every staff member registers their own account.
 *
 * The 76 accounts came from the Sheet import, not from people signing up — 75
 * of them still carry a temp password they never changed. This clears those
 * accounts and turns each one into an *invite* on the self-registration
 * allowlist, so the same person can create their own account (their own
 * password) at /login → Register with nothing else changing for them.
 *
 * An invite carries the name, role, branch(es), position and pay tier of the
 * account it replaces, so a re-registered teacher lands back exactly where they
 * were. Pass --all-teachers if an admin should re-assign every role by hand
 * afterwards instead — that demotes the other admins too, so keep one admin
 * account with --keep or the run is refused.
 *
 * Safe by design:
 *   - Dry run by default. Pass --apply to actually write. A dry run never
 *     touches the database or the disk.
 *   - --apply first writes a full JSON backup of every account it is about to
 *     delete (including the password hash and branch rows) to
 *     <data dir>/backups/, so a reset can be undone.
 *   - Admin accounts are kept by default — an admin has to stay signed in to
 *     assign the others. Pass --include-admins to reset them too, or name the
 *     survivors exactly with --keep.
 *   - --keep only accepts addresses that really exist. A typo aborts the run
 *     instead of quietly deleting the account it was meant to protect.
 *   - Refuses to run if the result would leave nobody able to sign in or
 *     register as an admin.
 *   - A deleted account takes its own roster row with it (and that row's
 *     lessons), the same as deleting from Admin. Roster rows with no account
 *     attached are left alone.
 *
 * LOCAL DEV ONLY GOTCHA: if the profiles table ends up completely empty
 * (--include-admins with no --keep), seedIfEmpty() refills it with demo accounts
 * (admin@lqk.test / password123) on the next `npm run dev`. Production is safe
 * — the Dockerfile sets NODE_ENV=production, which skips seeding entirely — but
 * a local reset will hand itself demo logins back unless you re-register first.
 *
 * AFTER APPLYING: rotate SESSION_SECRET on the host. Sessions are pure JWTs
 * with no database lookup, so anyone already signed in keeps their access
 * (with their old role) for up to 30 days even though their account is gone.
 * Changing the secret is what actually signs everybody out.
 *
 * Usage (run in the same environment as the app, i.e. same LQK_DATA_DIR):
 *   node scripts/reset-accounts.mjs                          # preview only
 *   node scripts/reset-accounts.mjs --apply                  # reset non-admins
 *   node scripts/reset-accounts.mjs --all-teachers --apply   # …and blank their roles
 *   node scripts/reset-accounts.mjs --include-admins --apply # reset admins too
 *
 *   # Start fresh from one account: delete everyone else, still let them back in.
 *   node scripts/reset-accounts.mjs --keep karim@littlequrankids.sg --apply
 *
 *   # Truly empty: no invites either, so nobody can register until an admin
 *   # adds their email in Admin → Invited emails.
 *   node scripts/reset-accounts.mjs --keep karim@littlequrankids.sg --no-invites --apply
 */

// getDb() seeds demo accounts unless NODE_ENV is production — never do that here.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, getDataDir } from "../lib/db.js";

const apply = process.argv.includes("--apply");
const includeAdmins = process.argv.includes("--include-admins");
const allTeachers = process.argv.includes("--all-teachers");
const noInvites = process.argv.includes("--no-invites");

// --keep a@b.com --keep c@d.com  |  --keep=a@b.com,c@d.com
// Naming survivors overrides the role-based rule: everyone not named goes,
// admin or not.
const keepEmails = new Set();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  const value = arg.startsWith("--keep=") ? arg.slice(7) : arg === "--keep" ? process.argv[++i] : null;
  if (!value) continue;
  for (const email of value.split(",")) {
    const clean = email.trim().toLowerCase();
    if (clean) keepEmails.add(clean);
  }
}

// Rows that belong to a person and die with them (ON DELETE CASCADE).
const OWNED = [
  ["teacher_locations", "teacher_id"],
  ["hafalan_entries", "teacher_id"],
  ["reading_entries", "teacher_id"],
  ["quran_bookmarks", "teacher_id"],
  ["work_sessions", "teacher_id"],
  ["notes", "teacher_id"],
  ["kalimah_progress", "teacher_id"],
  ["reader_activity", "teacher_id"],
  ["certifications", "teacher_id"],
  ["honours", "teacher_id"],
  ["nominations", "nominee_id"],
  ["nominations", "nominator_id"],
];

// Rows that outlive the person and just lose the pointer. These have no
// ON DELETE clause, so SQLite would block the delete — they are NULLed first.
// students.profile_id is deliberately absent: an account's roster row is part
// of that person, so it is deleted outright (see rosterFor below), matching
// what Admin → delete now does.
const DETACH = [
  ["lessons", "teacher_id"],
  ["hafalan_entries", "reviewer_id"],
  ["work_sessions", "reviewer_id"],
  ["certifications", "reviewer_id"],
  ["honours", "awarded_by"],
  ["lesson_packs", "created_by"],
  ["lesson_packs", "approved_by"],
  ["invites", "invited_by"],
];

const db = getDb();
const now = new Date().toISOString();

const profiles = db.prepare("SELECT * FROM profiles ORDER BY role, full_name").all();

// A --keep address that matches nothing is almost always a typo, and the cost
// of guessing wrong is deleting the one account that was meant to survive.
if (keepEmails.size > 0) {
  const known = new Set(profiles.map((p) => p.email.toLowerCase()));
  const unknown = [...keepEmails].filter((e) => !known.has(e));
  if (unknown.length > 0) {
    console.error(`\nRefusing to run: no account matches --keep ${unknown.join(", ")}.`);
    console.error("Check the spelling — nothing has been changed.\n");
    process.exit(1);
  }
}

const survives = (p) =>
  keepEmails.size > 0 ? keepEmails.has(p.email.toLowerCase()) : !includeAdmins && p.role === "admin";
const doomedIds = new Set(profiles.filter((p) => !survives(p)).map((p) => p.id));
const doomed = profiles.filter((p) => doomedIds.has(p.id));
const kept = profiles.filter((p) => !doomedIds.has(p.id));

if (doomed.length === 0) {
  console.log("\nNothing to reset — no matching accounts.\n");
  process.exit(0);
}

// Branch access lives in teacher_locations; the invite carries it as JSON so
// register() can rebuild those rows.
const locsFor = db.prepare("SELECT location, is_primary FROM teacher_locations WHERE teacher_id = ?");

const plan = doomed.map((p) => {
  const locs = locsFor.all(p.id);
  const extras = locs.map((l) => l.location).filter((l) => l !== p.primary_location);
  return {
    profile: p,
    role: allTeachers ? "teacher" : p.role,
    branches: extras,
    locations: locs,
  };
});

// Someone must still be able to administer the portal afterwards. With
// --no-invites an admin invite is never written, so only surviving accounts
// count towards that.
const adminInvites = noInvites ? 0 : plan.filter((p) => p.role === "admin").length;
const adminsAfter = kept.filter((p) => p.role === "admin").length + adminInvites;
if (adminsAfter === 0) {
  console.error("\nRefusing to run: that would leave no admin account and no admin invite.\n");
  process.exit(1);
}

// What the cascade will take with it.
const ids = [...doomedIds];
const placeholders = ids.map(() => "?").join(",");
const losses = [];
for (const [table, col] of OWNED) {
  const { n } = db.prepare(`SELECT count(*) n FROM ${table} WHERE ${col} IN (${placeholders})`).get(...ids);
  if (n > 0) losses.push({ table, col, n });
}
const detaches = [];
for (const [table, col] of DETACH) {
  const { n } = db.prepare(`SELECT count(*) n FROM ${table} WHERE ${col} IN (${placeholders})`).get(...ids);
  if (n > 0) detaches.push({ table, col, n });
}

const byRole = new Map();
for (const p of plan) byRole.set(p.role, (byRole.get(p.role) || 0) + 1);

console.log(`\n${apply ? "APPLYING" : "DRY RUN — nothing written (pass --apply to write)"}\n`);
console.log(`Accounts: ${profiles.length}   resetting: ${doomed.length}   keeping: ${kept.length}\n`);

if (kept.length) {
  console.log("Keeping (still able to sign in):");
  for (const k of kept) console.log(`  ${k.full_name} <${k.email}> — ${k.role}`);
  console.log("");
}

if (noInvites) {
  console.log(`Deleting ${doomed.length} accounts. NO invites are written, so none of these`);
  console.log("people can register until an admin adds their email in Admin → Invited emails:");
  for (const [role, count] of [...byRole].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)} × ${role} (was)`);
  }
} else {
  console.log(`Deleting ${doomed.length} accounts and re-inviting the same addresses as:`);
  for (const [role, count] of [...byRole].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)} × ${role}`);
  }
  if (allTeachers) {
    console.log("  (--all-teachers: everyone comes back plain, for an admin to re-assign by hand)");
  }
}

// Roster rows belonging to the deleted accounts go with them, and take their
// lessons and juz milestones by cascade. Roster rows with no account attached
// are left alone — nobody asked for those to go.
const rosterRows = db
  .prepare(`SELECT count(*) n FROM students WHERE profile_id IN (${placeholders})`)
  .get(...ids).n;
const rosterLessons = db
  .prepare(
    `SELECT count(*) n FROM lessons WHERE student_id IN (SELECT id FROM students WHERE profile_id IN (${placeholders}))`
  )
  .get(...ids).n;

console.log("\nData deleted with those accounts:");
if (losses.length === 0 && rosterRows === 0) console.log("  (none — these accounts have no entries yet)");
for (const l of losses) console.log(`  ${String(l.n).padStart(4)} × ${l.table}.${l.col}`);
if (rosterRows > 0) {
  console.log(`  ${String(rosterRows).padStart(4)} × staff roster row (and ${rosterLessons} logged lesson(s))`);
}

console.log("\nKept but unlinked from the deleted accounts:");
if (detaches.length === 0) console.log("  (none)");
for (const d of detaches) console.log(`  ${String(d.n).padStart(4)} × ${d.table}.${d.col} → NULL`);

if (!apply) {
  console.log("\nRe-run with --apply to write. Rotate SESSION_SECRET afterwards to sign everyone out.\n");
  process.exit(0);
}

// ---- Write -------------------------------------------------------------

const backupDir = path.join(getDataDir(), "backups");
mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `accounts-${now.replace(/[:.]/g, "-")}.json`);
writeFileSync(
  backupPath,
  JSON.stringify({ created_at: now, accounts: plan.map((p) => ({ ...p.profile, locations: p.locations })) }, null, 2)
);
console.log(`\nBackup written: ${backupPath}`);

const delInvite = db.prepare("DELETE FROM invites WHERE email = ?");
const insInvite = db.prepare(
  `INSERT INTO invites (id, email, full_name, role, primary_location, position, pay_tier, branches, invited_by, created_at, used_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`
);
const delProfile = db.prepare("DELETE FROM profiles WHERE id = ?");

db.exec("BEGIN");
try {
  // Roster rows first, while profile_id still points at the accounts.
  db.prepare(`DELETE FROM students WHERE profile_id IN (${placeholders})`).run(...ids);
  for (const [table, col] of DETACH) {
    db.prepare(`UPDATE ${table} SET ${col} = NULL WHERE ${col} IN (${placeholders})`).run(...ids);
  }
  for (const { profile, role, branches } of plan) {
    // A stale invite for the same address would block re-inviting later, so it
    // goes either way.
    delInvite.run(profile.email);
    if (!noInvites) {
      insInvite.run(
        randomUUID(),
        profile.email,
        profile.full_name || null,
        role,
        profile.primary_location || null,
        profile.position || null,
        profile.pay_tier || null,
        JSON.stringify(branches),
        now
      );
    }
    delProfile.run(profile.id);
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  console.error(`\nFailed — rolled back, nothing changed.\n${err.message}\n`);
  process.exit(1);
}

const left = db.prepare("SELECT count(*) n FROM profiles").get().n;
const pending = db.prepare("SELECT count(*) n FROM invites WHERE used_at IS NULL").get().n;
console.log(`Done. Accounts remaining: ${left}   pending invites: ${pending}`);
console.log("\nNext: rotate SESSION_SECRET on the host, or anyone already signed in keeps");
console.log("their old access for up to 30 days (sessions are not checked against the DB).\n");

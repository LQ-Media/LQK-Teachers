/**
 * Match monitored-roster rows (students) to login accounts (profiles) by name,
 * so a staff member's own lessons can be credited to their Achievements page.
 *
 * Both tables were imported from the same Google Sheet — the Students tab and
 * the Teachers tab — so most names match exactly once case and spacing are
 * normalised. Anything ambiguous is left alone and listed for an admin to set by
 * hand in Achievements → Manage → Account links.
 *
 * Usage:
 *   node scripts/link-roster-accounts.mjs --dry-run     # report only, no writes
 *   node scripts/link-roster-accounts.mjs               # apply the safe matches
 *   node scripts/link-roster-accounts.mjs --relink      # also redo existing links
 *   node scripts/link-roster-accounts.mjs --create-missing
 *       # …and give every remaining account its own roster row, so no login is
 *       # missing from the roster. Registration does this automatically now;
 *       # this is the backfill for accounts created before that.
 *
 * Run it in the same environment as the app (same LQK_DATA_DIR) so it writes to
 * the same database — e.g. in the Railway console after a deploy.
 */

// getDb() seeds demo accounts unless NODE_ENV is production. This script must
// never create demo data, so default to production when unset.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

import { getDb } from "../lib/db.js";
import { classForBranch } from "../lib/roster.js";

const dryRun = process.argv.includes("--dry-run");
const relink = process.argv.includes("--relink");
const createMissing = process.argv.includes("--create-missing");

// "NURUL  AIN BINTE ALI" -> "nurul ain binte ali". Also drops the honorifics and
// filial markers that appear on one side of the Sheet but not the other.
function normalise(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(ustaz|ustazah|ust|mr|mrs|ms|md|muhd)\b/g, " ")
    .replace(/\b(bin|binte|binti|bt|s\/o|d\/o)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const db = getDb();

const students = db.prepare("SELECT id, name, class, profile_id FROM students ORDER BY name").all();
const profiles = db.prepare("SELECT id, full_name, email FROM profiles ORDER BY full_name").all();

// Group accounts by normalised name so a duplicate name is never auto-matched.
const byName = new Map();
for (const p of profiles) {
  const key = normalise(p.full_name);
  if (!key) continue;
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(p);
}

// An account already claimed by another roster row is off the table: linking it
// twice would double-count that person's hafalan.
const claimed = new Set(students.filter((s) => s.profile_id).map((s) => s.profile_id));

const matched = [];
const ambiguous = [];
const unmatched = [];
const skipped = [];

for (const s of students) {
  if (s.profile_id && !relink) {
    skipped.push(s);
    continue;
  }
  const key = normalise(s.name);
  const candidates = (byName.get(key) || []).filter((p) => !claimed.has(p.id) || p.id === s.profile_id);

  if (candidates.length === 1) {
    matched.push({ student: s, profile: candidates[0] });
    claimed.add(candidates[0].id);
  } else if (candidates.length > 1) {
    ambiguous.push({ student: s, candidates });
  } else {
    unmatched.push(s);
  }
}

if (!dryRun && matched.length) {
  const update = db.prepare("UPDATE students SET profile_id = ? WHERE id = ?");
  for (const m of matched) update.run(m.profile.id, m.student.id);
}

// --create-missing: accounts that matched nothing get a roster row of their
// own, so every login appears on the roster. Registration does this by itself
// now (lib/roster.js#attachToRoster); this catches the accounts that predate it.
const linkedProfiles = new Set([
  ...students.filter((s) => s.profile_id).map((s) => s.profile_id),
  ...matched.map((m) => m.profile.id),
]);
const rosterless = createMissing ? profiles.filter((p) => !linkedProfiles.has(p.id)) : [];

if (!dryRun && rosterless.length) {
  const branchOf = db.prepare("SELECT primary_location, position FROM profiles WHERE id = ?");
  const insert = db.prepare(
    "INSERT INTO students (id, name, class, juz, position, photo, profile_id, created_at) VALUES (?, ?, ?, 1, ?, '', ?, ?)"
  );
  let { max } = db.prepare("SELECT MAX(id) AS max FROM students").get();
  for (const p of rosterless) {
    const row = branchOf.get(p.id) || {};
    max = (max || 0) + 1;
    insert.run(max, p.full_name, classForBranch(row.primary_location), String(row.position || ""), p.id, new Date().toISOString());
  }
}

// ---- Report -----------------------------------------------------------

const line = "─".repeat(64);
console.log(line);
console.log(dryRun ? "DRY RUN — nothing was written" : "Roster ↔ account linking");
console.log(line);

console.log(`\n✓ ${matched.length} matched${dryRun ? " (would link)" : " and linked"}`);
for (const m of matched) {
  console.log(`   ${m.student.name}  →  ${m.profile.full_name} <${m.profile.email}>`);
}

if (ambiguous.length) {
  console.log(`\n! ${ambiguous.length} ambiguous — more than one account shares the name, left unlinked`);
  for (const a of ambiguous) {
    console.log(`   ${a.student.name}  →  ${a.candidates.map((c) => c.email).join(" | ")}`);
  }
}

if (unmatched.length) {
  console.log(`\n· ${unmatched.length} with no matching account (they may simply not have a login)`);
  for (const u of unmatched) console.log(`   ${u.name}  (${u.class})`);
}

if (skipped.length) {
  console.log(`\n· ${skipped.length} already linked (pass --relink to redo them)`);
}

if (createMissing) {
  console.log(`\n+ ${rosterless.length} account(s) with no roster row${dryRun ? " (would add)" : " — added"}`);
  for (const p of rosterless) console.log(`   ${p.full_name} <${p.email}>`);
} else {
  const wouldAdd = profiles.filter((p) => !linkedProfiles.has(p.id)).length;
  if (wouldAdd) {
    console.log(`\n· ${wouldAdd} account(s) have no roster row — pass --create-missing to add them`);
  }
}

console.log(
  `\nFinish the rest by hand in Achievements → Manage → Account links.` +
    (dryRun ? "\nRe-run without --dry-run to apply.\n" : "\n")
);

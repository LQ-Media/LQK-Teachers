// Assign the two tiers of admin access.
//
//   node scripts/set-admin-scopes.mjs            # dry run, shows what it WOULD do
//   node scripts/set-admin-scopes.mjs --apply    # writes
//
// The list below is LQK's, from Karim on 16 Sep 2026. It lives in a script
// rather than in the schema or a seed because it is an operational decision
// that will change as people join and leave — and because a name in source code
// is a name somebody has to remember to delete.
//
// Matching is by NAME, fuzzily, because that is all we were given. It is
// deliberately cautious: a name that matches nobody, or more than one person, is
// REPORTED AND SKIPPED rather than guessed at. Handing the wrong person payroll
// access is not a mistake worth risking to save a minute of typing.
//
// Everything here is idempotent. Run it again after adding the missing people.

process.env.NODE_ENV ||= "production";
const { getDb, LOCATIONS } = await import("../lib/db.js");
const { randomUUID } = await import("node:crypto");

const FULL = ["Nur Abdul Karim", "Siti Suaidah", "Nurul Iman Fatimah", "Siti Malia"];

const CENTRE = [
  ["Zafirah", ["Woods Square"]],
  ["Sabrina", ["Primz Bizhub"]],
  ["Khairunnisa", ["Tampines Blk 462", "Tampines Junction"]],
  ["Zulaiha", ["Primz Bizhub"]],
  ["Aisyah Dahlan", ["Tampines Blk 462", "Tampines Junction"]],
  ["Mellisha", ["Woods Square"]],
  ["Nadiah Salam", ["Woods Square"]],
];

const apply = process.argv.includes("--apply");
const db = getDb();
const people = db.prepare("SELECT id, full_name, email, role, admin_scope FROM profiles").all();

/** Everyone whose full name contains every word of the query, case-insensitively. */
function find(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return people.filter((p) => {
    const name = (p.full_name || "").toLowerCase();
    return words.every((w) => name.includes(w));
  });
}

const problems = [];

function resolve(query) {
  const hits = find(query);
  if (hits.length === 0) {
    problems.push(`NO MATCH   ${query} — nobody in profiles has that name.`);
    return null;
  }
  if (hits.length > 1) {
    problems.push(
      `AMBIGUOUS  ${query} — matches ${hits.length}: ${hits.map((h) => `${h.full_name} <${h.email}>`).join(", ")}`
    );
    return null;
  }
  return hits[0];
}

const plan = [];

for (const name of FULL) {
  const p = resolve(name);
  if (p) plan.push({ p, scope: "full", branches: [] });
}

for (const [name, branches] of CENTRE) {
  const bad = branches.filter((b) => !LOCATIONS.includes(b));
  if (bad.length) {
    problems.push(`BAD BRANCH ${name} — ${bad.join(", ")} is not in LOCATIONS.`);
    continue;
  }
  const p = resolve(name);
  if (p) plan.push({ p, scope: "centre", branches });
}

console.log(`${apply ? "APPLYING" : "DRY RUN — pass --apply to write"}\n`);

for (const { p, scope, branches } of plan) {
  const was = p.role === "admin" ? p.admin_scope || "centre" : `not an admin (${p.role})`;
  console.log(
    `${scope === "full" ? "FULL  " : "CENTRE"}  ${(p.full_name || "").padEnd(34)} ${String(p.email).padEnd(32)} ` +
      `was: ${was}${branches.length ? ` -> ${branches.join(" + ")}` : ""}`
  );
}

if (problems.length) {
  console.log(`\n${problems.length} NOT APPLIED:`);
  for (const line of problems) console.log(`  ${line}`);
}

if (!apply) {
  console.log("\nNothing written.");
  process.exit(problems.length ? 1 : 0);
}

db.exec("BEGIN");
try {
  for (const { p, scope, branches } of plan) {
    db.prepare("UPDATE profiles SET role = 'admin', admin_scope = ? WHERE id = ?").run(scope, p.id);
    db.prepare("DELETE FROM manager_branches WHERE manager_id = ?").run(p.id);
    for (const b of branches) {
      db.prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?, ?, ?)").run(
        randomUUID(),
        p.id,
        b
      );
    }
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

console.log(`\nApplied to ${plan.length} account(s).`);
if (problems.length) {
  console.log(`${problems.length} still need attention — fix the names and run it again.`);
  process.exit(1);
}

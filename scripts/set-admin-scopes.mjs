// Assign the two tiers of admin access, from a terminal.
//
//   node scripts/set-admin-scopes.mjs            # dry run, shows what it WOULD do
//   node scripts/set-admin-scopes.mjs --apply    # writes
//
// THE SAME JOB IS ON THE ADMIN SCREEN (Admin → Access), which is where Karim
// will normally do it — assigning who can see payroll should not need a CLI.
// This stays for the case where the portal itself is the thing that is broken,
// and for anyone who would rather read a plan in a terminal.
//
// Both paths resolve the list through lib/admin/scopes.js. That is deliberate:
// two copies of a name-matching rule is two answers to "does Khairunnisaa' have
// access", and only one of them would be right.
//
// Matching is by NAME, fuzzily, because that is all we were given. It is
// deliberately cautious: a name that matches nobody, or more than one person, is
// REPORTED AND SKIPPED rather than guessed at. Handing the wrong person payroll
// access is not a mistake worth risking to save a minute of typing.
//
// Everything here is idempotent. Run it again after adding the missing people.

process.env.NODE_ENV ||= "production";
const { getDb, LOCATIONS } = await import("../lib/db.js");
const { resolveScopePlan } = await import("../lib/admin/scopes.js");
const { randomUUID } = await import("node:crypto");

const apply = process.argv.includes("--apply");
const db = getDb();
const people = db.prepare("SELECT id, full_name, email, role, admin_scope FROM profiles").all();

const { plan, problems } = resolveScopePlan(people, LOCATIONS);

console.log(`${apply ? "APPLYING" : "DRY RUN — pass --apply to write"}\n`);

for (const row of plan) {
  console.log(
    `${row.scope === "full" ? "FULL  " : "CENTRE"}  ${String(row.name).padEnd(34)} ${String(row.email).padEnd(32)} ` +
      `was: ${row.was}${row.branches.length ? ` -> ${row.branches.join(" + ")}` : ""}`
  );
}

if (problems.length) {
  console.log(`\n${problems.length} NOT APPLIED:`);
  for (const p of problems) {
    const label = { no_match: "NO MATCH  ", ambiguous: "AMBIGUOUS ", bad_branch: "BAD BRANCH" }[p.kind] || p.kind;
    console.log(`  ${label} ${p.query} — ${p.detail}`);
  }
}

if (!apply) {
  console.log("\nNothing written.");
  process.exit(problems.length ? 1 : 0);
}

db.exec("BEGIN");
try {
  for (const row of plan) {
    db.prepare("UPDATE profiles SET role = 'admin', admin_scope = ? WHERE id = ?").run(row.scope, row.id);
    db.prepare("DELETE FROM manager_branches WHERE manager_id = ?").run(row.id);
    for (const branch of row.branches) {
      db.prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?, ?, ?)").run(
        randomUUID(),
        row.id,
        branch
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

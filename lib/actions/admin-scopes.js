"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireFullAdmin } from "@/lib/dal";
import { getDb, LOCATIONS } from "@/lib/db";
import { resolveScopePlan } from "@/lib/admin/scopes";

// Assigning the two tiers of admin access, from the Admin screen.
//
// This exists because the alternative was a terminal. Karim will run this every
// time somebody joins or leaves, and "who can see payroll" is not a question
// that should require the Railway CLI to answer.
//
// FULL ADMIN ONLY, both to preview and to apply — this is the thing that hands
// out payroll access, so a centre IT Head must not be able to grant it to
// themselves. requireFullAdmin redirects rather than returning, which is the
// correct shape for a page but means these actions can only be called from one.

function people(db) {
  return db.prepare("SELECT id, full_name, email, role, admin_scope FROM profiles").all();
}

/**
 * What WOULD change. Writes nothing.
 *
 * The same resolution the script does, through the same pure module, so the two
 * cannot drift into disagreeing about whether a name matched.
 */
export async function previewAdminScopes() {
  await requireFullAdmin();
  const db = getDb();
  const { plan, problems } = resolveScopePlan(people(db), LOCATIONS);

  // What each person holds today, so the screen can show the before as well as
  // the after — "was: not an admin" is the row worth reading twice.
  const current = db
    .prepare(
      `SELECT p.id, p.full_name, p.email, p.role, p.admin_scope,
              (SELECT GROUP_CONCAT(m.branch, ', ') FROM manager_branches m WHERE m.manager_id = p.id) AS branches
       FROM profiles p WHERE p.role = 'admin'
       ORDER BY p.admin_scope DESC, p.full_name ASC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.full_name,
      email: r.email,
      scope: r.admin_scope === "full" ? "full" : "centre",
      branches: r.branches ? r.branches.split(", ") : [],
    }));

  return { plan, problems, current };
}

/**
 * Apply the plan.
 *
 * Only ever writes what preview resolved UNIQUELY — anything ambiguous or
 * unmatched is skipped here exactly as it is there, because the plan is
 * recomputed rather than passed in from the browser. A client that posted its
 * own list of ids would be a way to grant payroll access to anybody.
 */
export async function applyAdminScopes() {
  await requireFullAdmin();
  const db = getDb();
  const { plan, problems } = resolveScopePlan(people(db), LOCATIONS);

  if (!plan.length) {
    return { error: "Nothing to apply — no name on the list matched exactly one account." };
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

  revalidatePath("/admin");
  return { ok: true, applied: plan.length, skipped: problems.length };
}

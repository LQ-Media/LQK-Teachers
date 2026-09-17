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

// ---- Setting one person's access by hand --------------------------------
//
// Karim, 17 Sep: "give me the button to decide who to give full, partial, none,
// so i can do the changes on my own when i need to."
//
// So the code list above becomes a starting point rather than the only way in.
// Everything below is per-person and immediate.

const SCOPES = ["full", "centre", "none"];

/** Everyone who could hold admin, with what they hold today. */
export async function accessRoster() {
  await requireFullAdmin();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.full_name, p.email, p.role, p.admin_scope, p.position, p.primary_location,
              (SELECT GROUP_CONCAT(m.branch, '|') FROM manager_branches m WHERE m.manager_id = p.id) AS branches
       FROM profiles p
       ORDER BY
         CASE WHEN p.role = 'admin' AND p.admin_scope = 'full' THEN 0
              WHEN p.role = 'admin' THEN 1 ELSE 2 END,
         p.full_name ASC`
    )
    .all()
    .map((r) => ({
      id: r.id,
      name: r.full_name,
      email: r.email,
      role: r.role,
      position: r.position || null,
      primaryLocation: r.primary_location || null,
      scope: r.role !== "admin" ? "none" : r.admin_scope === "full" ? "full" : "centre",
      branches: r.branches ? r.branches.split("|") : [],
    }));
  return { people: rows, locations: LOCATIONS };
}

/**
 * Set one person's access.
 *
 * `scope` is full | centre | none. "none" means role='teacher' — there is no
 * third role, and an admin with nothing is still an admin as far as every
 * `requireRole(["admin"])` in the codebase is concerned.
 *
 * TWO GUARDS, both about locking people out rather than about letting them in:
 *
 *   • You cannot demote YOURSELF. Not because it is dangerous in principle, but
 *     because the person doing it loses the screen mid-action and cannot undo
 *     it. Somebody else with full access can.
 *   • The LAST full admin cannot be demoted. With none left, nobody can reach
 *     this screen or payroll again, and the only way back is a terminal — which
 *     is the thing this screen exists to avoid.
 *
 * The second is belt and braces rather than a path you can walk: the caller is
 * always a full admin, so demoting somebody ELSE always leaves the caller, and
 * demoting YOURSELF is stopped by the first guard. It stays because the two
 * together are what make "there is always a way back in" true no matter which
 * one is loosened later, and because the caller's own scope could in principle
 * be revoked by another admin between the check and the write.
 */
export async function setAdminScope(userId, scope, branches = []) {
  const session = await requireFullAdmin();
  const db = getDb();
  const id = String(userId ?? "").trim();
  const want = SCOPES.includes(scope) ? scope : null;
  if (!want) return { error: "Pick full, centre or none." };

  const row = db.prepare("SELECT id, full_name, role, admin_scope FROM profiles WHERE id = ?").get(id);
  if (!row) return { error: "That account no longer exists." };

  const was = row.role !== "admin" ? "none" : row.admin_scope === "full" ? "full" : "centre";

  if (id === session.userId && want !== "full") {
    return {
      error:
        "You can’t remove your own full access — you’d lose this screen halfway through. Ask another full admin to do it.",
    };
  }

  if (was === "full" && want !== "full") {
    const others = db
      .prepare("SELECT COUNT(*) AS n FROM profiles WHERE role = 'admin' AND admin_scope = 'full' AND id != ?")
      .get(id).n;
    if (!others) {
      return { error: "That’s the last full admin. Give somebody else full access first." };
    }
  }

  const wanted = (Array.isArray(branches) ? branches : [])
    .map((b) => String(b).trim())
    .filter((b) => LOCATIONS.includes(b));

  // A centre admin with no centres sees nothing at all. That is the safe
  // direction for an unset value, but as a deliberate choice it is almost
  // certainly a mistake, so it is refused rather than quietly applied.
  if (want === "centre" && !wanted.length) {
    return { error: "Pick at least one centre — a centre admin with none assigned sees nothing." };
  }

  const before = db
    .prepare("SELECT branch FROM manager_branches WHERE manager_id = ? ORDER BY branch")
    .all(id)
    .map((r) => r.branch);

  db.exec("BEGIN");
  try {
    if (want === "none") {
      db.prepare("UPDATE profiles SET role = 'teacher', admin_scope = NULL WHERE id = ?").run(id);
      db.prepare("DELETE FROM manager_branches WHERE manager_id = ?").run(id);
    } else {
      db.prepare("UPDATE profiles SET role = 'admin', admin_scope = ? WHERE id = ?").run(want, id);
      db.prepare("DELETE FROM manager_branches WHERE manager_id = ?").run(id);
      if (want === "centre") {
        for (const b of wanted) {
          db.prepare("INSERT INTO manager_branches (id, manager_id, branch) VALUES (?, ?, ?)").run(
            randomUUID(),
            id,
            b
          );
        }
      }
    }

    db.prepare(
      `INSERT INTO admin_scope_log
         (id, subject_id, changed_by, changed_by_name, from_scope, to_scope, from_branches, to_branches, changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      id,
      session.userId,
      session.fullName || null,
      was,
      want,
      before.join(", ") || null,
      want === "centre" ? wanted.join(", ") : null,
      new Date().toISOString()
    );

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  revalidatePath("/admin");
  return { ok: true, name: row.full_name, was, scope: want, branches: want === "centre" ? wanted : [] };
}

/** The last 50 access changes, newest first. */
export async function accessLog() {
  await requireFullAdmin();
  const rows = getDb()
    .prepare(
      `SELECT l.*, p.full_name AS subject_name
       FROM admin_scope_log l
       LEFT JOIN profiles p ON p.id = l.subject_id
       ORDER BY l.changed_at DESC LIMIT 50`
    )
    .all()
    .map((r) => ({
      id: r.id,
      subject: r.subject_name || "(deleted account)",
      by: r.changed_by_name || "(unknown)",
      from: r.from_scope,
      to: r.to_scope,
      fromBranches: r.from_branches || null,
      toBranches: r.to_branches || null,
      at: r.changed_at,
    }));
  return { entries: rows };
}

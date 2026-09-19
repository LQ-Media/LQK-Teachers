import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import { getDb } from "./db";

export async function requireSession() {
  const session = await getSession();
  if (!session?.userId) {
    redirect("/login");
  }
  return session;
}

export async function requireRole(roles) {
  const session = await requireSession();
  if (!roles.includes(session.role)) {
    redirect("/dashboard?denied=1");
  }
  return session;
}

// ---- Two tiers of admin ------------------------------------------------
//
// MH and IT Heads both hold role='admin', but they do different jobs:
//
//   full    — Founders, HR, the Mentor Head. Everything, payroll included.
//   centre  — An IT Head for one or two centres. Rosters and edits their
//             shifts, sees their attendance exceptions, is told when their
//             teachers are late. No payroll, no approvals, no user admin.
//
// The scope is read PER REQUEST from the database, never from the JWT. Taking
// somebody's payroll access away has to take effect now, not whenever their
// session happens to expire — the same discipline as is_assessor.

/** The scope stored against an admin, or null for anyone who is not one. */
export function adminScopeOf(userId) {
  if (!userId) return null;
  const row = getDb()
    .prepare("SELECT role, admin_scope FROM profiles WHERE id = ?")
    .get(userId);
  if (!row || row.role !== "admin") return null;
  // A row with no scope is an admin created before the column existed and not
  // yet migrated. Treat it as a CENTRE admin, not a full one: the safe failure
  // for an unknown scope is less access, never more.
  return row.admin_scope === "full" ? "full" : "centre";
}

/** Either tier — enough to open the Admin area at all. */
export async function requireAdmin() {
  const session = await requireRole(["admin"]);
  return { ...session, adminScope: adminScopeOf(session.userId) };
}

/**
 * Payroll, approvals, rates, user administration.
 *
 * Every payroll reader and writer must go through this rather than
 * requireRole(["admin"]), which a centre admin now also passes.
 */
export async function requireFullAdmin() {
  const session = await requireRole(["admin"]);
  if (adminScopeOf(session.userId) !== "full") {
    redirect("/dashboard?denied=1");
  }
  return session;
}

/**
 * The branches an admin may act on, or NULL meaning "all of them".
 *
 * NULL rather than the full list on purpose: a caller then writes
 * `if (branches) ...filter`, and forgetting the filter fails OPEN only for a
 * full admin, who was allowed everything anyway. Returning the whole list
 * would make the two cases look identical and hide the mistake.
 *
 * A centre admin with no branches assigned gets an empty array — they see
 * nothing, which is correct and visible, rather than everything.
 */
export function managedBranches(userId) {
  if (adminScopeOf(userId) === "full") return null;
  return getDb()
    .prepare("SELECT branch FROM manager_branches WHERE manager_id = ? ORDER BY branch")
    .all(userId)
    .map((r) => r.branch);
}

/** True when this admin may act on a shift at `branch`. */
export function canManageBranch(userId, branch) {
  const allowed = managedBranches(userId);
  if (allowed === null) return true;
  return allowed.includes(branch);
}

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

/**
 * Is this account allowed into the peer-assessment screens? Admins always;
 * anyone else only while an admin has ticked "Assessor" on their profile.
 *
 * Read from the row, not the JWT, so withdrawing the flag takes effect on the
 * person's next request rather than at their next sign-in.
 */
export function canAssessFor(session) {
  if (!session?.userId) return false;
  if (session.role === "admin") return true;
  const row = getDb().prepare("SELECT is_assessor FROM profiles WHERE id = ?").get(session.userId);
  return !!row?.is_assessor;
}

export async function requireAssessor() {
  const session = await requireSession();
  if (!canAssessFor(session)) {
    redirect("/dashboard?denied=1");
  }
  return { ...session, isAdmin: session.role === "admin" };
}

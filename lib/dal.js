import "server-only";
import { redirect } from "next/navigation";
import { getSession } from "./session";

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

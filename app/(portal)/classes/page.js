import { requireSession, canAssessFor } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { classesData } from "@/lib/actions/classes";
import { sgToday } from "@/lib/hours/rates";
import ClassesApp from "@/components/classes/ClassesApp";

export const metadata = { title: "My classes · LQK Teachers Portal" };

/**
 * The children a teacher actually teaches, straight from the parents
 * portal's enrolment. Assessors and admins may look at another teacher's
 * classes with ?teacher=<id> — that is how criteria A1 and A2 are checked.
 */
export default async function ClassesPage({ searchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const teacherId = typeof sp?.teacher === "string" && canAssessFor(session) ? sp.teacher : null;

  let data;
  try {
    data = await classesData(teacherId);
  } catch (err) {
    data = { configured: true, scope: { teacherId: session.userId, name: session.fullName, own: true }, classes: [], reports: [], error: err.message };
  }
  const viewedName = data.scope.own ? null : getDb().prepare("SELECT full_name FROM profiles WHERE id = ?").get(data.scope.teacherId)?.full_name;

  return <ClassesApp initial={data} today={sgToday()} viewedName={viewedName} />;
}

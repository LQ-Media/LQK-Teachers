import { requireRole } from "@/lib/dal";
import { getDb, LOCATIONS, TRACKER_CLASSES } from "@/lib/db";
import { avatarSrc } from "@/lib/avatar";
import AdminApp from "@/components/admin/AdminApp";

export const metadata = { title: "Admin · LQK Teachers Portal" };

export default async function AdminPage() {
  const session = await requireRole(["admin"]);
  const db = getDb();

  const profiles = db
    .prepare("SELECT id, full_name, email, role, primary_location, position, photo FROM profiles ORDER BY full_name")
    .all();
  const locRows = db.prepare("SELECT teacher_id, location, is_primary FROM teacher_locations").all();
  const byTeacher = new Map();
  for (const r of locRows) {
    if (!byTeacher.has(r.teacher_id)) byTeacher.set(r.teacher_id, []);
    byTeacher.get(r.teacher_id).push(r.location);
  }
  const users = profiles.map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    role: p.role,
    primary_location: p.primary_location || "",
    position: p.position || "",
    branches: byTeacher.get(p.id) || (p.primary_location ? [p.primary_location] : []),
    avatar: avatarSrc(p.id, p.photo),
    isSelf: p.id === session.userId,
  }));

  const studentRows = db.prepare("SELECT id, name, class, juz, position FROM students ORDER BY class, name").all();
  const lessonCounts = db.prepare("SELECT student_id, COUNT(*) AS c FROM lessons GROUP BY student_id").all();
  const countBy = new Map(lessonCounts.map((r) => [r.student_id, r.c]));
  const staff = studentRows.map((s) => ({
    id: s.id,
    name: s.name,
    class: s.class,
    juz: s.juz,
    position: s.position || "",
    lessonCount: countBy.get(s.id) || 0,
  }));

  return (
    <AdminApp users={users} staff={staff} locations={LOCATIONS} classes={TRACKER_CLASSES} />
  );
}

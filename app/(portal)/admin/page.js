import { requireRole } from "@/lib/dal";
import { getDb, LOCATIONS, TRACKER_CLASSES } from "@/lib/db";
import { avatarSrc } from "@/lib/avatar";
import { hoursAdminData } from "@/lib/actions/hours";
import { shiftsForRange, missedShifts } from "@/lib/actions/shifts";
import { sgMonthNow } from "@/lib/hours/rates";
import AdminApp from "@/components/admin/AdminApp";

export const metadata = { title: "Admin · LQK Teachers Portal" };

export default async function AdminPage() {
  const session = await requireRole(["admin"]);
  const db = getDb();

  const profiles = db
    .prepare("SELECT id, full_name, email, role, primary_location, position, photo, pay_tier FROM profiles ORDER BY full_name")
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
    pay_tier: p.pay_tier || "",
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

  const inviteRows = db
    .prepare(
      "SELECT id, email, full_name, role, primary_location, position, pay_tier, created_at FROM invites WHERE used_at IS NULL ORDER BY created_at DESC"
    )
    .all();
  const invites = inviteRows.map((i) => ({
    id: i.id,
    email: i.email,
    full_name: i.full_name || "",
    role: i.role,
    primary_location: i.primary_location || "",
    position: i.position || "",
    pay_tier: i.pay_tier || "",
  }));

  const initialHours = await hoursAdminData(sgMonthNow());
  // The roster tab opens on the fortnight ahead, plus whatever is outstanding
  // from the past week — the two things an admin actually acts on.
  const [range, missedList] = await Promise.all([shiftsForRange(), missedShifts()]);
  const initialShifts = { ...range, missed: missedList.missed };

  return (
    <AdminApp
      users={users}
      staff={staff}
      invites={invites}
      locations={LOCATIONS}
      classes={TRACKER_CLASSES}
      initialHours={initialHours}
      initialShifts={initialShifts}
    />
  );
}

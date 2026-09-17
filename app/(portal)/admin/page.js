import { requireAdmin, managedBranches } from "@/lib/dal";
import { getDb, LOCATIONS } from "@/lib/db";
import { SHIFT_LOCATIONS } from "@/lib/hours/locations";
import { avatarSrc } from "@/lib/avatar";
import { hoursAdminData } from "@/lib/actions/hours";
import { shiftsForRange, missedShifts, attendanceExceptions } from "@/lib/actions/shifts";
import { payrollReport } from "@/lib/actions/payroll";
import { reliefBoard } from "@/lib/actions/relief";
import { rangeFor, todayAnchor } from "@/lib/hours/calendar";
import { geofenceEnabled } from "@/lib/hours/geocode";
import { livePositions } from "@/lib/hours/position-store";
import { signupRow } from "@/lib/admin/signup";
import { mailConfigured } from "@/lib/events/mail";
import { sgMonthNow } from "@/lib/hours/rates";
import AdminApp from "@/components/admin/AdminApp";

export const metadata = { title: "Admin · LQK Teachers Portal" };

export default async function AdminPage() {
  const session = await requireAdmin();
  const fullAdmin = session.adminScope === "full";
  const branches = managedBranches(session.userId);
  const db = getDb();

  // last_login_at and must_change_password come along so the Login accounts
  // table can show who has actually signed up without a second round trip, and
  // the reminder subqueries so it can show who has already been chased.
  const profiles = db
    .prepare(
      `SELECT p.id, p.full_name, p.email, p.role, p.admin_scope, p.primary_location, p.position,
              p.photo, p.pay_tier, p.must_change_password, p.last_login_at, p.created_at,
              (SELECT MAX(r.at) FROM signup_reminders r WHERE r.subject_id = p.id AND r.ok = 1) AS reminded_at,
              (SELECT COUNT(*) FROM signup_reminders r WHERE r.subject_id = p.id AND r.ok = 1) AS reminder_count
       FROM profiles p ORDER BY p.full_name`
    )
    .all();
  const locRows = db.prepare("SELECT teacher_id, location, is_primary FROM teacher_locations").all();
  const mgrRows = db.prepare("SELECT manager_id, branch FROM manager_branches").all();
  const managedBy = new Map();
  for (const r of mgrRows) {
    if (!managedBy.has(r.manager_id)) managedBy.set(r.manager_id, []);
    managedBy.get(r.manager_id).push(r.branch);
  }
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
    admin_scope: p.admin_scope || "",
    managed_branches: managedBy.get(p.id) || [],
    primary_location: p.primary_location || "",
    position: p.position || "",
    pay_tier: p.pay_tier || "",
    branches: byTeacher.get(p.id) || (p.primary_location ? [p.primary_location] : []),
    avatar: avatarSrc(p.id, p.photo),
    isSelf: p.id === session.userId,
    // Shaped by the same pure module the reminder action uses, so the screen
    // and the send can never disagree about who has signed up.
    signup: signupRow(p),
  }));

  // The tracked-staff roster (the `students` table) is no longer read here.
  // Karim removed that tab on 17 Sep: "remove the Staff Roster, i dont need
  // that tab". The rows themselves are untouched and still drive the Tracker,
  // the dashboard and achievements — and creating a login account still
  // creates or links one, via attachToRoster() in lib/roster.js. What is gone
  // is the screen that edited a row's class and juz by hand.

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

  // Payroll and approvals are loaded ONLY for a full admin. They are not just
  // hidden in the UI: requireFullAdmin REDIRECTS, so eagerly calling them here
  // would bounce a centre IT Head out of the Admin area entirely rather than
  // showing them the roster they do have.
  const initialHours = fullAdmin ? await hoursAdminData(sgMonthNow()) : null;
  const monthRange = rangeFor("month", todayAnchor());
  const [range, missedList, exceptionList, payroll, board] = await Promise.all([
    // The whole month GRID, not a fortnight: the roster opens as a calendar,
    // and fetching less than it renders would leave the padding cells empty —
    // an admin reading real holes where there are none.
    shiftsForRange(monthRange.from, monthRange.to),
    missedShifts(),
    attendanceExceptions(),
    fullAdmin ? payrollReport() : Promise.resolve(null),
    reliefBoard(),
  ]);
  const initialShifts = {
    ...range,
    missed: missedList.missed,
    exceptions: exceptionList.exceptions,
    relief: board,
  };

  return (
    <AdminApp
      users={users}
      invites={invites}
      locations={LOCATIONS}
      shiftLocations={SHIFT_LOCATIONS}
      initialHours={initialHours}
      initialShifts={initialShifts}
      initialPayroll={payroll}
      fullAdmin={fullAdmin}
      managedBranches={branches}
      // One boolean, so the Locations screen can say whether the clock-in check
      // is live. A centre IT Head may read that; only a full admin may change
      // it, which is why the panel that changes it lives behind Settings.
      fenceOn={geofenceEnabled()}
      // So the Send-reminder button can say why it is disabled rather than
      // failing silently when RESEND_API_KEY is not set on this server.
      mailReady={mailConfigured()}
      // The live position list, so the Add-shift dropdown and the Positions
      // tile's count both follow what the Positions screen says.
      positions={livePositions()}
    />
  );
}

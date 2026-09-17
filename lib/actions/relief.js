"use server";

import { revalidatePath } from "next/cache";
import { requireSession, requireAdmin, adminScopeOf, canManageBranch } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { minutesBetween } from "@/lib/hours/rates";
import { notifyShiftOffered } from "@/lib/hours/notify-scheduler";

// Relief: a shift its teacher cannot work, offered for somebody else to take.
//
// Karim's description, 16 Sep 2026: "when they offer the shift, it is for both
// classes and there are situations where 1 teacher accepts both class or if 2
// separate teachers are taking 1 each, that is where the manual change is
// needed from IT Head."
//
// So an offer is always for the WHOLE shift. One teacher taking both classes is
// the ordinary path and needs nothing special. Two teachers taking one class
// each is the IT Head splitting the shift first (splitShift, in shifts.js) and
// then each half standing on its own. That keeps this file free of a
// part-accepted state, which is the thing that would otherwise have to be
// reconciled at payroll.

function clean(v) {
  return String(v ?? "").trim();
}

/** The fields every screen needs, shaped for a Client Component. */
function toOffer(r) {
  return {
    id: r.id,
    date: r.date,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    branch: r.branch || null,
    category: r.category,
    otReason: r.ot_reason || null,
    phName: r.ph_name || null,
    minutes: minutesBetween(r.starts_at, r.ends_at),
    offeredAt: r.offered_at || null,
    offerReason: r.offer_reason || null,
    offerFrom: r.offer_from || null,
    offerFromName: r.offer_from_name || null,
    teacherId: r.teacher_id,
    teacherName: r.teacher_name || null,
    takenBy: r.taken_by || null,
    takenByName: r.taken_by_name || null,
    takenAt: r.taken_at || null,
  };
}

const OFFER_SELECT = `
  SELECT s.*,
         p.full_name  AS teacher_name,
         f.full_name  AS offer_from_name,
         t.full_name  AS taken_by_name
  FROM shifts s
  JOIN profiles p ON p.id = s.teacher_id
  LEFT JOIN profiles f ON f.id = s.offer_from
  LEFT JOIN profiles t ON t.id = s.taken_by
`;

/**
 * May this person put this shift on the board?
 *
 * The teacher who holds it, or an admin who manages its branch. A teacher
 * offering somebody else's shift is not a thing — it reads as helpfulness and
 * behaves as taking a class off a colleague without asking.
 */
function mayOffer(session, scope, row) {
  if (row.teacher_id === session.userId) return true;
  if (!scope) return false;
  return canManageBranch(session.userId, row.branch);
}

/**
 * Put a shift on the board.
 *
 * Refused once anybody has clocked in, and refused for a shift that has already
 * started. Both are the same principle: an offer is a request for somebody to
 * turn up, and neither of those can still be answered.
 */
export async function offerShift(shiftId, reason) {
  const session = await requireSession();
  const db = getDb();
  const now = new Date().toISOString();

  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(shiftId));
  if (!row) return { error: "Shift not found." };
  if (row.status === "cancelled") return { error: "That shift is cancelled." };
  // A draft isn't arranged yet, so there is nothing to ask cover for. Teachers
  // cannot reach one at all; this stops an admin offering one by hand.
  if (!row.published) return { error: "That shift is still a draft. Publish it before offering it." };

  const scope = adminScopeOf(session.userId);
  if (!mayOffer(session, scope, row)) {
    return { error: "That isn’t your shift to offer." };
  }

  if (new Date(row.starts_at) <= new Date(now)) {
    return { error: "That shift has already started. Tell your IT Head instead — they can reassign it." };
  }
  if (db.prepare("SELECT id FROM work_sessions WHERE shift_id = ?").get(row.id)) {
    return { error: "Somebody has already clocked in for this shift." };
  }
  if (row.offered_at) return { error: "That shift is already on the board." };

  db.prepare(
    `UPDATE shifts
     SET offered_at = ?, offered_by = ?, offer_from = ?, offer_reason = ?, updated_at = ?
     WHERE id = ? AND offered_at IS NULL`
  ).run(now, session.userId, row.teacher_id, clean(reason) || null, now, row.id);

  // Tell everybody it needs cover. Push failures must not fail the offer — the
  // shift is on the board either way, and the board is the source of truth.
  try {
    await notifyShiftOffered(
      {
        id: row.id,
        teacherId: row.teacher_id,
        branch: row.branch,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      },
      []
    );
  } catch (err) {
    console.error("[relief] offer notification failed:", err?.message || err);
  }

  revalidatePath("/hours");
  revalidatePath("/admin");
  return { ok: true };
}

/** Take it back off the board. The person who offered it, or an admin. */
export async function withdrawOffer(shiftId) {
  const session = await requireSession();
  const db = getDb();

  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(shiftId));
  if (!row) return { error: "Shift not found." };
  if (!row.offered_at) return { error: "That shift isn’t on the board." };

  const scope = adminScopeOf(session.userId);
  if (!mayOffer(session, scope, row)) return { error: "That isn’t your shift to withdraw." };

  db.prepare(
    "UPDATE shifts SET offered_at = NULL, offer_reason = NULL, updated_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), row.id);

  revalidatePath("/hours");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Take an offered shift.
 *
 * THE RACE IS THE WHOLE PROBLEM HERE. A shift goes on the board, everybody's
 * phone buzzes at once, and several people tap "take" within the same second.
 * Exactly one of them must get it, and the others must be told plainly rather
 * than all being shown a success and two of them turning up.
 *
 * So the claim is a single conditional UPDATE guarded on `offered_at IS NOT
 * NULL`, and the winner is decided by `changes`. Reading first and writing
 * second — however short the gap — is what would let two people win.
 */
export async function takeShift(shiftId) {
  const session = await requireSession();
  const db = getDb();
  const uid = session.userId;
  const now = new Date().toISOString();

  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(shiftId));
  if (!row) return { error: "Shift not found." };
  if (!row.offered_at) return { error: "Somebody else has already taken that shift." };
  if (row.status === "cancelled") return { error: "That shift is cancelled." };
  if (row.teacher_id === uid) return { error: "That’s already your shift." };
  if (new Date(row.starts_at) <= new Date(now)) {
    return { error: "That shift has already started." };
  }

  // A clash is checked BEFORE the claim, because the honest answer to "you
  // already teach then" is to refuse, not to hand them two classes at once.
  // The window between this and the claim can only cost them the shift to
  // somebody faster, which is the correct outcome of a race.
  const clash = db
    .prepare(
      `SELECT id FROM shifts
       WHERE teacher_id = ? AND status = 'planned' AND id != ?
         AND starts_at < ? AND ends_at > ?`
    )
    .get(uid, row.id, row.ends_at, row.starts_at);
  if (clash) {
    return { error: "You already have a shift that overlaps this one." };
  }

  let claimed;
  try {
    claimed = db
      .prepare(
        `UPDATE shifts
         SET teacher_id = ?, taken_by = ?, taken_at = ?, offered_at = NULL, updated_at = ?
         WHERE id = ? AND offered_at IS NOT NULL AND status != 'cancelled' AND published = 1`
      )
      .run(uid, uid, now, now, row.id).changes;
  } catch (err) {
    // idx_shifts_unique_planned: this teacher already holds a shift starting at
    // exactly this instant. The overlap check above catches almost all of these;
    // this is the same answer for the case it cannot see.
    if (String(err?.message || "").includes("UNIQUE")) {
      return { error: "You already have a shift at that time." };
    }
    throw err;
  }

  if (!claimed) return { error: "Somebody else got there first." };

  revalidatePath("/hours");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, startsAt: row.starts_at, branch: row.branch };
}

/**
 * The board: every shift currently offered and still in the future.
 *
 * A past offer nobody took is not an opportunity, it is a shift that went
 * uncovered — it belongs on the IT Head's exception list, not here, so it is
 * filtered out rather than left to sit at the top of the list forever.
 *
 * Own shifts are excluded: the list is what you could pick up, and the one you
 * just gave away is not that.
 */
export async function availableShifts() {
  const session = await requireSession();
  const rows = getDb()
    .prepare(
      `${OFFER_SELECT}
       WHERE s.offered_at IS NOT NULL
         AND s.status = 'planned'
         AND s.published = 1
         AND s.starts_at > ?
         AND s.teacher_id != ?
       ORDER BY s.starts_at ASC`
    )
    .all(new Date().toISOString(), session.userId)
    .map(toOffer);
  return { shifts: rows };
}

/** What this person has put on the board and nobody has taken yet. */
export async function myOffers() {
  const session = await requireSession();
  const rows = getDb()
    .prepare(
      `${OFFER_SELECT}
       WHERE s.offered_at IS NOT NULL AND s.teacher_id = ?
       ORDER BY s.starts_at ASC`
    )
    .all(session.userId)
    .map(toOffer);
  return { shifts: rows };
}

/**
 * The admin view: everything on the board, plus what has changed hands, scoped
 * to the branches this admin manages.
 *
 * Shifts that went UNCOVERED lead, because they are the ones that need somebody
 * to do something today. A covered shift is a record; an uncovered one starting
 * in two hours is a problem.
 */
export async function reliefBoard() {
  const session = await requireAdmin();
  const db = getDb();
  const now = new Date().toISOString();
  const mine = adminScopeOf(session.userId) === "full" ? null : true;

  const keep = (r) => mine === null || canManageBranch(session.userId, r.branch);

  const open = db
    .prepare(`${OFFER_SELECT} WHERE s.offered_at IS NOT NULL AND s.status = 'planned' ORDER BY s.starts_at ASC`)
    .all()
    .filter(keep)
    .map(toOffer);

  const taken = db
    .prepare(`${OFFER_SELECT} WHERE s.taken_by IS NOT NULL ORDER BY s.starts_at DESC LIMIT 100`)
    .all()
    .filter(keep)
    .map(toOffer);

  return {
    uncovered: open.filter((s) => new Date(s.startsAt) <= new Date(now)),
    open: open.filter((s) => new Date(s.startsAt) > new Date(now)),
    taken,
  };
}

// No formatting helper lives here on purpose: this file carries "use server",
// so every export must be an async server action. The board's labels are built
// in the component, from sgClock and sgDate.

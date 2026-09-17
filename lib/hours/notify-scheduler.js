import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { subscriptionsFor } from "@/lib/azan/store";
import { sendPush } from "@/lib/azan/push";
import { dueFor, teacherMessage, managerMessage, REMIND_BEFORE_MIN } from "./notify.js";

// Shift notifications, sent from the server on a timer.
//
// Runs beside the azan scheduler (lib/azan/scheduler.js) and is started the
// same way, from instrumentation.js. It shares that feature's push plumbing
// and, deliberately, its subscriptions: a teacher grants notification
// permission to the PORTAL, once, and the portal is one app. Asking twice for
// the same browser permission would mostly teach people to say no.
//
// The decision of what is due lives in ./notify.js and is pure. Everything
// here is the parts that need a database: who, whether they were already told,
// and the send itself.

const TICK_MS = 60_000;

// Only shifts near the current moment can have anything due. The widest window
// any rule uses is "30 minutes before the start" to "the scheduled end", so a
// query bounded by those two, with an hour of slack each side for timezone and
// clock drift, cannot miss one.
const LOOKAHEAD_MS = (REMIND_BEFORE_MIN + 60) * 60 * 1000;
const LOOKBEHIND_MS = 12 * 60 * 60 * 1000;

/**
 * Shifts that could plausibly have a notification due, with the teacher's name
 * and their clock-in if there is one.
 *
 * `status != 'cancelled'` matters more than it looks: a cancelled shift must
 * never produce a "you haven't clocked in", because the teacher is right not
 * to be there and telling them off for it is worse than saying nothing.
 */
function candidateShifts(nowMs) {
  const from = new Date(nowMs - LOOKBEHIND_MS).toISOString();
  const to = new Date(nowMs + LOOKAHEAD_MS).toISOString();
  return getDb()
    .prepare(
      `SELECT s.id, s.teacher_id, s.category, s.status, s.branch,
              s.starts_at, s.ends_at,
              p.full_name AS teacher_name,
              w.clock_in_at AS clock_in_at
       FROM shifts s
       JOIN profiles p ON p.id = s.teacher_id
       LEFT JOIN work_sessions w ON w.shift_id = s.id AND w.status != 'rejected'
       WHERE s.starts_at BETWEEN ? AND ?
         AND s.status != 'cancelled'`
    )
    .all(from, to)
    .map((r) => ({
      id: r.id,
      teacherId: r.teacher_id,
      teacherName: r.teacher_name,
      category: r.category,
      status: r.status,
      branch: r.branch,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      clockInAt: r.clock_in_at || null,
    }));
}

/**
 * The IT Heads who should hear about a shift going wrong at this branch.
 *
 * Scoped to the branch, per Karim on 16 Sep 2026: a centre IT Head receives
 * "the late notification of their centre teachers" — not every centre's. Full
 * admins are NOT copied on every one; four people receiving every late tap in
 * five centres is a mute button waiting to happen.
 *
 * The fallback is the part that matters. A shift with no branch, or at a
 * branch nobody has been assigned, would otherwise notify NOBODY — the silent
 * failure where everyone assumes someone else was told. So when no centre
 * admin covers it, the full admins get it instead. The message always reaches
 * a person.
 */
export function managersForBranch(branch) {
  const db = getDb();
  if (branch) {
    const centre = db
      .prepare(
        `SELECT DISTINCT p.id
         FROM profiles p
         JOIN manager_branches m ON m.manager_id = p.id
         WHERE p.role = 'admin' AND m.branch = ?`
      )
      .all(branch)
      .map((r) => r.id);
    if (centre.length) return centre;
  }
  return db
    .prepare("SELECT id FROM profiles WHERE role = 'admin' AND admin_scope = 'full'")
    .all()
    .map((r) => r.id);
}

/**
 * Claim one notification. Returns true only for the caller that won the row.
 *
 * Claim-before-send, not send-then-record: a crash between the two should cost
 * one notification, not produce a loop that re-sends the same push on every
 * tick for the rest of the shift. A push that fails is already handled
 * downstream — sendPush prunes subscriptions the browser has revoked.
 */
function claim(shiftId, kind, recipientId, nowIso) {
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO shift_notifications (id, shift_id, kind, recipient_id, sent_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), shiftId, kind, recipientId, nowIso);
  return res.changes > 0;
}

async function pushTo(recipientId, message) {
  if (!message) return 0;
  const subs = subscriptionsFor(recipientId);
  let sent = 0;
  for (const sub of subs) {
    if (await sendPush(sub, message)) sent++;
  }
  return sent;
}

/**
 * One pass. Exported so a test, or an admin screen, can run it deliberately
 * rather than waiting for a timer.
 */
export async function runShiftNotifications(nowIso = new Date().toISOString()) {
  const nowMs = new Date(nowIso).getTime();
  let shifts;
  try {
    shifts = candidateShifts(nowMs);
  } catch (err) {
    console.error("[shifts] notification query failed:", err?.message || err);
    return { claimed: 0, pushed: 0 };
  }

  let claimed = 0;
  let pushed = 0;

  for (const shift of shifts) {
    for (const { kind, minutes } of dueFor(shift, shift.clockInAt, nowIso)) {
      // The teacher.
      if (claim(shift.id, kind, shift.teacherId, nowIso)) {
        claimed++;
        pushed += await pushTo(shift.teacherId, teacherMessage(kind, shift, minutes));
      }

      // Their IT Heads, for a no-show only. A reminder is the teacher's
      // business; a missing clock-in is the centre's.
      if (kind !== "no_clock_in") continue;
      for (const managerId of managersForBranch(shift.branch)) {
        if (managerId === shift.teacherId) continue; // an admin's own shift
        if (!claim(shift.id, `${kind}:mgr`, managerId, nowIso)) continue;
        claimed++;
        pushed += await pushTo(managerId, managerMessage(kind, shift, minutes));
      }
    }
  }

  return { claimed, pushed };
}

/**
 * Tell everyone with a subscription that a shift needs cover.
 *
 * Called by the relief flow when a shift is made available — the third thing
 * Karim asked for. The relief marketplace itself is not built yet, so nothing
 * calls this in anger; it is here because the dedupe, the claim and the
 * message all belong with the rest of the shift notifications rather than
 * being reinvented later.
 *
 * `excludeIds` keeps the offer away from the teacher who gave it up and from
 * anyone already rostered against it.
 */
export async function notifyShiftOffered(shift, excludeIds = []) {
  const nowIso = new Date().toISOString();
  const exclude = new Set([shift.teacherId, ...excludeIds].filter(Boolean));
  const recipients = getDb()
    .prepare(
      `SELECT DISTINCT p.id
       FROM profiles p
       JOIN push_subscriptions s ON s.teacher_id = p.id
       WHERE p.role IN ('teacher', 'admin')`
    )
    .all()
    .map((r) => r.id)
    .filter((id) => !exclude.has(id));

  let pushed = 0;
  for (const id of recipients) {
    if (!claim(shift.id, "offered", id, nowIso)) continue;
    pushed += await pushTo(id, teacherMessage("offered", shift, 0));
  }
  return pushed;
}

export function startShiftNotifications() {
  // Survive dev-server HMR re-imports: only ever one interval per process.
  if (globalThis.__lqkShiftNotifier) return;
  globalThis.__lqkShiftNotifier = setInterval(() => {
    runShiftNotifications().catch((err) =>
      console.error("[shifts] notification tick failed:", err?.message || err)
    );
  }, TICK_MS);
  console.log("[shifts] notification scheduler started");
}

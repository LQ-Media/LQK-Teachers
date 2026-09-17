"use server";

// Server actions for the shift roster.
//
// Admins (MH and IT Heads both hold the `admin` role) roster teaching shifts
// ahead of time and insert OT shifts after approving them verbally. Teachers
// only read their own roster and explain a missed clock-in.
//
// Shifts are CANCELLED, never deleted, once anything has been worked against
// them: work_sessions.shift_id is a real FK under `PRAGMA foreign_keys = ON`,
// so deleting a worked shift would throw a 500 rather than explain itself — and
// a cancelled shift still answers "was this ever rostered?".

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession, requireRole, requireFullAdmin, managedBranches, canManageBranch } from "@/lib/dal";
import { getDb } from "@/lib/db";
// SHIFT_LOCATIONS, not lib/db's LOCATIONS: a SHIFT can be at "Outside LQK" or
// "Online", which are not branches a PERSON can belong to. See the note at the
// bottom of lib/hours/locations.js.
import { SHIFT_LOCATIONS } from "@/lib/hours/locations";
import { isoFromSgSpanning, sgDate, sgToday, addSgDays, sgWeekday } from "@/lib/hours/rates";
import { buildShiftRows, findOverlaps, isMissed, shiftMinutes, MISSED_REASONS } from "@/lib/hours/shifts";
import { positionMeaning, repeatMeaning } from "@/lib/hours/positions";
import { endOfSgWeek } from "@/lib/hours/calendar";
import { attendanceOf } from "@/lib/hours/attendance";
import { holidayMap, fetchHolidays } from "@/lib/hours/holidays";

function clean(v) {
  return String(v ?? "").trim();
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name ?? null,
    payTier: row.pay_tier ?? null,
    // The position the shift is WORKED in — Sling puts it on the shift, and a
    // lead teacher covering an assistant's class is working that class. Set by
    // the New shift form; NULL on every shift made before that form existed.
    position: row.position ?? null,
    // The teacher's job title, free text from the imported Sheet. The fallback
    // when the shift itself doesn't say, which is most of the back catalogue.
    teacherPosition: row.teacher_position ?? null,
    category: row.category,
    otReason: row.ot_reason || null,
    otRole: row.ot_role || null,
    branch: row.branch || null,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    cancelReason: row.cancel_reason || null,
    phName: row.ph_name || null,
    unpaid: !!row.unpaid,
    // Sling's PUBLISH toggle. Drafts are invisible to teachers, so the admin
    // screens have to say so — an unexplained gap in somebody's roster is the
    // kind of thing that gets discovered at 7:25 in the morning.
    published: row.published === undefined ? true : !!row.published,
    missedReason: row.missed_reason || null,
    missedReasonAt: row.missed_reason_at || null,
    resolution: row.resolution || null,
    note: row.note || null,
    batchId: row.batch_id || null,
    sessionId: row.session_id ?? null,
    clockInAt: row.clock_in_at ?? null,
    clockInOriginalAt: row.clock_in_original_at ?? null,
    sessionStartedAt: row.session_started_at ?? null,
    sessionStatus: row.session_status ?? null,
    adjustReason: row.adjust_reason ?? null,
    minutes: shiftMinutes({ startsAt: row.starts_at, endsAt: row.ends_at }),
  };
}

// Shifts joined to whichever session (if any) fulfilled them. LEFT JOIN, so an
// unworked shift still appears — that is the whole point of the missed report.
const SELECT = `
  SELECT s.*, p.full_name AS teacher_name, p.pay_tier AS pay_tier, p.position AS teacher_position,
         w.id AS session_id, w.clock_in_at AS clock_in_at,
         w.clock_in_original_at AS clock_in_original_at,
         w.started_at AS session_started_at, w.status AS session_status,
         w.adjust_reason AS adjust_reason
  FROM shifts s
  JOIN profiles p ON p.id = s.teacher_id
  LEFT JOIN work_sessions w ON w.shift_id = s.id
`;

/**
 * The branches this admin may act on, or null for a full admin.
 *
 * Every shift writer calls this and refuses a branch outside it. A centre IT
 * Head rostering at somebody else's centre is not a hypothetical: the teacher
 * pickers list everyone, so the only thing standing between a misclick and a
 * shift on the wrong roster is this check.
 */
function scopeOf(session) {
  return managedBranches(session.userId);
}

/** Refuse a write outside the admin's branches. Returns an error string or null. */
function refuseBranch(session, branch) {
  if (canManageBranch(session.userId, branch)) return null;
  const mine = scopeOf(session);
  if (mine && !mine.length) {
    return "You have no centres assigned yet. Ask a full admin to set them.";
  }
  return `That shift is at ${branch || "no centre"}, which isn’t one of yours.`;
}

/** Narrow a list of shaped shifts to the ones this admin may see. */
function visibleTo(session, rows) {
  const mine = scopeOf(session);
  if (mine === null) return rows;
  const set = new Set(mine);
  return rows.filter((r) => set.has(r.branch));
}

/**
 * Record a change to a shift. Sling's "Shift history".
 *
 * Not exported: this file carries "use server", so every export must be an
 * async server action, and this is called synchronously from inside them.
 *
 * `actorName` is denormalised on purpose. The log has to still read correctly
 * after the person who made the change has left and their profile is gone,
 * which is exactly when somebody goes looking at it.
 */
function logShift(db, session, shiftId, action, field = null, from = null, to = null) {
  db.prepare(
    `INSERT INTO shift_history (id, shift_id, actor_id, actor_name, action, field, from_value, to_value, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    shiftId,
    session?.userId || null,
    session?.fullName || null,
    action,
    field,
    from == null ? null : String(from),
    to == null ? null : String(to),
    new Date().toISOString()
  );
}

function holidays(db) {
  return holidayMap(db.prepare("SELECT date, name FROM public_holidays").all());
}

function validate({ date, startTime, endTime, category }) {
  if (!YMD.test(date)) return "Pick a valid date.";
  if (!HHMM.test(startTime) || !HHMM.test(endTime)) return "Enter start and end times as HH:MM.";
  if (startTime === endTime) return "The start and end times can’t be the same.";
  if (category !== "teaching" && category !== "ot") return "Pick a shift type.";
  return null;
}

// ---- Admin: create / edit / cancel -------------------------------------

export async function editShift(data) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(data.id));
  if (!row) return { error: "Shift not found." };

  // Both ends are checked. Guarding only the destination would let a centre
  // admin reach into somebody else's centre and move a shift out of it.
  const deniedFrom = refuseBranch(session, row.branch);
  if (deniedFrom) return { error: deniedFrom };
  if (data.branch !== undefined) {
    const target = SHIFT_LOCATIONS.includes(clean(data.branch)) ? clean(data.branch) : null;
    const deniedTo = refuseBranch(session, target);
    if (deniedTo) return { error: deniedTo };
  }

  const date = clean(data.date) || row.date;
  const startTime = clean(data.startTime) || row.start_time;
  const endTime = clean(data.endTime) || row.end_time;
  const bad = validate({ date, startTime, endTime, category: row.category });
  if (bad) return { error: bad };

  const span = isoFromSgSpanning(date, startTime, endTime);
  if (!span) return { error: "Those times don’t make a valid shift." };

  // A worked shift's times are already copied onto the session, which is what
  // pays. Moving the shift underneath it would leave the two disagreeing, with
  // the roster looking authoritative and the payroll silently unchanged.
  const worked = db.prepare("SELECT id FROM work_sessions WHERE shift_id = ?").get(row.id);
  if (worked && (span.startsAt !== row.starts_at || span.endsAt !== row.ends_at)) {
    return { error: "This shift has already been worked — edit the session in Work hours instead." };
  }

  const now = new Date().toISOString();
  const branch = SHIFT_LOCATIONS.includes(clean(data.branch)) ? clean(data.branch) : row.branch;
  const ph = holidays(db).get(date) || null;

  // Reassigning the shift to somebody else — Sling's EMPLOYEE field. Only when
  // asked: an absent teacherId leaves it alone rather than reading as "clear
  // it", because an edit form that omits a field means "don't touch".
  let teacherId = row.teacher_id;
  if (data.teacherId !== undefined && clean(data.teacherId) && clean(data.teacherId) !== row.teacher_id) {
    if (worked) {
      return { error: "Somebody has already clocked in for this shift — reassigning it now would move their pay." };
    }
    const next = db.prepare("SELECT id FROM profiles WHERE id = ?").get(clean(data.teacherId));
    if (!next) return { error: "Pick a teacher who exists." };
    teacherId = next.id;

    // The new holder must actually be free. Checked here for the same reason as
    // in createShifts: an admin can still fix it, and the teacher is the wrong
    // person to discover a double-booking at the door.
    const theirs = db
      .prepare("SELECT * FROM shifts WHERE teacher_id = ? AND date = ? AND status = 'planned' AND id != ?")
      .all(teacherId, date, row.id)
      .map(shape);
    const candidate = { id: "moved", ...span, status: "planned" };
    if (findOverlaps([...theirs, candidate]).some((pair) => pair.some((x) => x.id === "moved"))) {
      return { error: "That clashes with a shift the new teacher already has that day." };
    }
  }

  try {
    db.prepare(
      `UPDATE shifts SET teacher_id = ?, branch = ?, date = ?, start_time = ?, end_time = ?,
                         starts_at = ?, ends_at = ?, ph_name = ?, unpaid = ?, note = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      teacherId, branch, date, startTime, endTime, span.startsAt, span.endsAt, ph,
      data.unpaid ? 1 : 0, clean(data.note) || null, now, row.id
    );
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) {
      return { error: "That teacher already has a shift starting at that time." };
    }
    throw err;
  }

  // One history row per field that actually moved, phrased the way Sling
  // phrases it — "edited the end time, from 7:30 PM to 8:00 PM". A single
  // "edited" row would not answer the question anybody opens history to ask.
  const nameOf = (id) =>
    db.prepare("SELECT full_name FROM profiles WHERE id = ?").get(id)?.full_name || id;
  if (teacherId !== row.teacher_id) {
    logShift(db, session, row.id, "reassigned", "teacher", nameOf(row.teacher_id), nameOf(teacherId));
  }
  if (date !== row.date) logShift(db, session, row.id, "edited", "date", row.date, date);
  if (startTime !== row.start_time) {
    logShift(db, session, row.id, "edited", "start time", row.start_time, startTime);
  }
  if (endTime !== row.end_time) {
    logShift(db, session, row.id, "edited", "end time", row.end_time, endTime);
  }
  if (branch !== row.branch) {
    logShift(db, session, row.id, "edited", "centre", row.branch || "none", branch || "none");
  }
  const note = clean(data.note) || null;
  if (note !== (row.note || null)) {
    logShift(db, session, row.id, "edited", "note", row.note || "(empty)", note || "(empty)");
  }

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true };
}

/**
 * Cancel a shift — a public holiday, a cancelled class, someone on leave.
 * Cancelled shifts never count as missed, so the weekly report stays honest.
 */
export async function cancelShift(id, reason) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare("SELECT id, branch FROM shifts WHERE id = ?").get(clean(id));
  if (!row) return { error: "Shift not found." };
  const denied = refuseBranch(session, row.branch);
  if (denied) return { error: denied };

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE shifts SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?"
  ).run(clean(reason) || "cancelled", session.userId, now, now, row.id);

  logShift(db, session, row.id, "cancelled", "reason", null, clean(reason) || "cancelled");

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true };
}

/** Cancel every planned shift on a date — the public-holiday button. */
export async function cancelDate(date, branch, reason) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const d = clean(date);
  if (!YMD.test(d)) return { error: "Pick a valid date." };

  const b = SHIFT_LOCATIONS.includes(clean(branch)) ? clean(branch) : null;
  // A null branch cancels the date at EVERY centre. That is a full admin's call
  // — a centre IT Head closing their own centre must not close everyone else's.
  const mine = scopeOf(session);
  if (mine !== null && !b) {
    return { error: "Pick which centre to cancel. Only a full admin can cancel every centre at once." };
  }
  const denied = b ? refuseBranch(session, b) : null;
  if (denied) return { error: denied };
  const now = new Date().toISOString();
  const params = b ? [d, b] : [d];
  const where = `date = ? AND status = 'planned'${b ? " AND branch = ?" : ""}`;

  const affected = db.prepare(`SELECT COUNT(*) c FROM shifts WHERE ${where}`).get(...params).c;
  db.prepare(
    `UPDATE shifts SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ?
     WHERE ${where}`
  ).run(clean(reason) || "holiday", session.userId, now, now, ...params);

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true, cancelled: affected };
}

/** Undo a bulk generation. Anything already worked is kept and reported. */
export async function deleteBatch(batchId) {
  await requireFullAdmin();
  const db = getDb();
  const id = clean(batchId);

  const rows = db.prepare(`${SELECT} WHERE s.batch_id = ?`).all(id).map(shape);
  if (!rows.length) return { error: "Nothing found for that batch." };

  const worked = rows.filter((r) => r.sessionId);
  const removable = rows.filter((r) => !r.sessionId);
  const del = db.prepare("DELETE FROM shifts WHERE id = ?");
  for (const r of removable) del.run(r.id);

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true, deleted: removable.length, kept: worked.length };
}

// ---- Admin: reading the roster ----------------------------------------

export async function shiftsForRange(fromDate, toDate) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const from = YMD.test(clean(fromDate)) ? clean(fromDate) : sgToday();
  const to = YMD.test(clean(toDate)) ? clean(toDate) : addSgDays(from, 13);

  const rows = db
    .prepare(`${SELECT} WHERE s.date BETWEEN ? AND ? ORDER BY s.date ASC, s.starts_at ASC`)
    .all(from, to)
    .map(shape);

  return { from, to, shifts: visibleTo(session, rows), scope: scopeOf(session) };
}

/**
 * The weekly exception list that replaces the manual chase: shifts nobody
 * clocked in for, still unresolved. Cancelled and already-resolved shifts are
 * excluded, so a rejected explanation is never asked about twice.
 */
export async function missedShifts(fromDate, toDate) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const now = new Date().toISOString();
  const from = YMD.test(clean(fromDate)) ? clean(fromDate) : addSgDays(sgToday(), -7);
  const to = YMD.test(clean(toDate)) ? clean(toDate) : sgToday();

  const rows = db
    .prepare(`${SELECT} WHERE s.date BETWEEN ? AND ? ORDER BY s.date DESC, s.starts_at ASC`)
    .all(from, to)
    .map(shape)
    .filter((s) => isMissed(s, now, !!s.sessionId));

  return { from, to, missed: visibleTo(session, rows) };
}

/**
 * The IT Heads' weekly chase, as one list.
 *
 * Everything in a date range where the clock-in did not go to plan: nobody
 * tapped at all, or they tapped 15 minutes or more after the shift started.
 * Both cost the teacher money now, so both belong in front of whoever is asking
 * why — which is the loop the IT Heads already run over Sling messages, only
 * with the answer landing on the shift instead of in a chat thread.
 *
 * Deliberately NOT filtered to unresolved. A shift that was already adjusted
 * stays on the list with its reason showing, because "we looked at this and
 * here is what we decided" is the useful state to see, and hiding it would make
 * the same shift get chased twice.
 *
 * Future shifts are excluded: a class that has not started yet has not been
 * missed, and including them would bury the real list under next fortnight's
 * roster.
 */
export async function attendanceExceptions(fromDate, toDate) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const now = new Date().toISOString();
  const from = YMD.test(clean(fromDate)) ? clean(fromDate) : addSgDays(sgToday(), -14);
  const to = YMD.test(clean(toDate)) ? clean(toDate) : sgToday();

  const all = db
    .prepare(`${SELECT} WHERE s.date BETWEEN ? AND ? ORDER BY s.date DESC, s.starts_at ASC`)
    .all(from, to)
    .map(shape)
    .filter((s) => new Date(s.startsAt) <= new Date(now))
    .map((s) => ({ ...s, attendance: attendanceOf(s, s.clockInAt) }))
    .filter((s) => s.attendance.flagged);
  const rows = visibleTo(session, all);

  return {
    from,
    to,
    exceptions: rows,
    lateCount: rows.filter((s) => s.attendance.state === "late").length,
    missingCount: rows.filter((s) => s.attendance.state === "missing").length,
  };
}

// ---- Teacher: my roster, and explaining a missed clock-in --------------

export async function myShifts(fromDate, toDate) {
  const session = await requireSession();
  const db = getDb();
  const from = YMD.test(clean(fromDate)) ? clean(fromDate) : sgToday();
  const to = YMD.test(clean(toDate)) ? clean(toDate) : addSgDays(from, 13);

  const rows = db
    .prepare(`${SELECT} WHERE s.teacher_id = ? AND s.date BETWEEN ? AND ? ORDER BY s.date ASC, s.starts_at ASC`)
    .all(session.userId, from, to)
    .map(shape);

  return { from, to, shifts: rows };
}

/**
 * A teacher's own explanation for not clocking in. This is the whole point of
 * the feature — it turns the weekly chase into something they answer once, in
 * the app, and an admin decides on.
 */
export async function explainMissed(shiftId, reason, detail) {
  const session = await requireSession();
  const db = getDb();
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(shiftId));
  if (!row) return { error: "Shift not found." };
  if (row.teacher_id !== session.userId) return { error: "That isn’t your shift." };
  if (row.resolution) return { error: "An admin has already dealt with this one." };

  const picked = clean(reason);
  if (!MISSED_REASONS.includes(picked)) return { error: "Pick a reason." };
  const text = picked === "Other" ? clean(detail) : [picked, clean(detail)].filter(Boolean).join(" — ");
  if (!text) return { error: "Add a short explanation." };

  const now = new Date().toISOString();
  db.prepare("UPDATE shifts SET missed_reason = ?, missed_reason_at = ?, updated_at = ? WHERE id = ?")
    .run(text, now, now, row.id);

  revalidatePath("/hours");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * An admin's decision on a missed shift. Accepting creates the work_session
 * that pays it, from the shift's own scheduled window — the same window a
 * clock-in would have produced. Rejecting records the decision so the report
 * stops asking.
 */
export async function resolveMissed(shiftId, accept, note) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(shiftId));
  if (!row) return { error: "Shift not found." };
  if (row.resolution) return { error: "This one has already been decided." };

  // A centre IT Head decides this for their own centres — Karim, 16 Sep 2026,
  // alongside adjustClockIn. They run the weekly chase, so they close it.
  const denied = refuseBranch(session, row.branch);
  if (denied) return { error: denied };

  const now = new Date().toISOString();

  if (accept) {
    if (new Date(row.ends_at) > new Date(now)) {
      return { error: "That shift hasn’t finished yet." };
    }
    try {
      db.prepare(
        `INSERT INTO work_sessions (id, teacher_id, category, ot_reason, branch, started_at, ended_at, note, status,
                                    shift_id, source, created_by, ph_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'missed_accepted', ?, ?, ?, ?)`
      ).run(
        randomUUID(), row.teacher_id, row.category, row.ot_reason, row.branch,
        row.starts_at, row.ends_at, clean(note) || null, row.id, session.userId, row.ph_name, now, now
      );
    } catch (err) {
      if (String(err?.message || "").includes("UNIQUE")) {
        return { error: "This shift already has a session." };
      }
      throw err;
    }
  }

  db.prepare(
    "UPDATE shifts SET resolution = ?, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?"
  ).run(accept ? "accepted" : "rejected", session.userId, now, now, row.id);

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true };
}

// ---- Public holidays ---------------------------------------------------

/**
 * Pull the public-holiday calendar from MOM and store it.
 *
 * The same job as scripts/sync-public-holidays.mjs, exposed to admins because
 * the script needs shell access to the Railway volume (`railway ssh`, which
 * needs an SSH key on Karim's account) — and without holidays loaded the
 * multiplier never fires. Additive: adds new dates and corrects renamed ones,
 * never deletes, because shifts may already be rostered against them.
 */
export async function syncHolidays() {
  await requireFullAdmin();
  const db = getDb();

  let feed;
  try {
    feed = await fetchHolidays();
  } catch (err) {
    return { error: `Couldn’t reach data.gov.sg: ${err?.message || "unknown error"}` };
  }

  const existing = new Map(db.prepare("SELECT date, name FROM public_holidays").all().map((r) => [r.date, r.name]));
  const now = new Date().toISOString();
  const insert = db.prepare("INSERT INTO public_holidays (date, name, created_at) VALUES (?, ?, ?)");
  const rename = db.prepare("UPDATE public_holidays SET name = ? WHERE date = ?");

  let added = 0;
  let renamed = 0;
  for (const h of feed) {
    const was = existing.get(h.date);
    if (was === undefined) {
      insert.run(h.date, h.name, now);
      added += 1;
    } else if (was !== h.name) {
      rename.run(h.name, h.date);
      renamed += 1;
    }
  }

  // Stamp any already-rostered shift that falls on a holiday we only just
  // learned about, so pay is right without re-rostering anything.
  const stamped = db
    .prepare(
      `UPDATE shifts SET ph_name = (SELECT name FROM public_holidays WHERE date = shifts.date), updated_at = ?
       WHERE ph_name IS NULL AND date IN (SELECT date FROM public_holidays)`
    )
    .run(now).changes;

  revalidatePath("/admin");
  return { ok: true, added, renamed, stamped, total: feed.length };
}

export async function listHolidays(fromDate, toDate) {
  await requireRole(["admin"]);
  const db = getDb();
  const from = YMD.test(clean(fromDate)) ? clean(fromDate) : sgDate(new Date().toISOString()).slice(0, 4) + "-01-01";
  const to = YMD.test(clean(toDate)) ? clean(toDate) : sgDate(new Date().toISOString()).slice(0, 4) + "-12-31";
  return {
    holidays: db
      .prepare("SELECT date, name FROM public_holidays WHERE date BETWEEN ? AND ? ORDER BY date ASC")
      .all(from, to),
  };
}

/**
 * Split one shift in two at a time, and optionally hand each half to somebody
 * else. ADMIN ONLY.
 *
 * This exists because of how relief actually works here. A teacher's rostered
 * shift usually covers two classes back to back, and when they give it away
 * they give away the whole thing. Sometimes one person takes both classes, in
 * which case nothing needs splitting. Often two people take one each — and then
 * the roster is wrong in a way no reassignment can fix, because the shift is
 * one row and it needs to be two. Today an IT Head fixes that by hand in Sling.
 *
 * What it does NOT do:
 *
 *   - It refuses once anybody has clocked in against the shift. A session
 *     copied that shift's window when it was created, so splitting underneath
 *     it would leave a paid session spanning two shifts that no longer add up
 *     to it. Cancel and re-roster instead; that path already exists and is
 *     honest about what happened.
 *   - It does not reassign silently. Each half is either kept with the original
 *     teacher or given to a named one, and both halves are checked for a clash
 *     against whoever ends up holding them — the same check createShifts makes,
 *     for the same reason: catch it while an admin is looking at it.
 *
 * `at` is an SG "HH:MM" strictly inside the shift. `firstTeacherId` and
 * `secondTeacherId` are optional; omitting one leaves that half where it is.
 */
export async function splitShift(shiftId, at, firstTeacherId, secondTeacherId) {
  const session = await requireRole(["admin"]);
  const db = getDb();

  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(shiftId));
  if (!row) return { error: "Shift not found." };
  if (row.status === "cancelled") return { error: "That shift is cancelled." };
  const denied = refuseBranch(session, row.branch);
  if (denied) return { error: denied };

  const worked = db.prepare("SELECT id FROM work_sessions WHERE shift_id = ?").get(row.id);
  if (worked) {
    return { error: "Somebody has already clocked in for this shift. Cancel it and roster the two halves instead." };
  }

  const cut = clean(at);
  if (!HHMM.test(cut)) return { error: "Give the split time as HH:MM." };

  const firstHalf = isoFromSgSpanning(row.date, row.start_time, cut);
  const secondHalf = isoFromSgSpanning(row.date, cut, row.end_time);
  if (!firstHalf || !secondHalf) return { error: "That split time doesn’t make two valid shifts." };
  if (
    new Date(firstHalf.startsAt) >= new Date(firstHalf.endsAt) ||
    new Date(secondHalf.startsAt) >= new Date(secondHalf.endsAt) ||
    new Date(firstHalf.endsAt).getTime() !== new Date(secondHalf.startsAt).getTime() ||
    new Date(secondHalf.endsAt).getTime() !== new Date(row.ends_at).getTime()
  ) {
    return { error: "The split has to fall inside the shift, not at either end." };
  }

  const firstTeacher = clean(firstTeacherId) || row.teacher_id;
  const secondTeacher = clean(secondTeacherId) || row.teacher_id;
  for (const id of new Set([firstTeacher, secondTeacher])) {
    if (!db.prepare("SELECT id FROM profiles WHERE id = ?").get(id)) return { error: "Pick a teacher who exists." };
  }

  // Clash check, per half, against whoever ends up holding it — excluding the
  // shift being split, since it is about to stop covering that time.
  const halves = [
    { teacherId: firstTeacher, span: firstHalf, id: "first" },
    { teacherId: secondTeacher, span: secondHalf, id: "second" },
  ];
  for (const half of halves) {
    const sameDay = db
      .prepare("SELECT * FROM shifts WHERE teacher_id = ? AND date = ? AND status = 'planned' AND id != ?")
      .all(half.teacherId, row.date, row.id)
      .map(shape);
    const candidate = { id: half.id, ...half.span, status: "planned" };
    if (findOverlaps([...sameDay, candidate]).some((pair) => pair.some((s) => s.id === half.id))) {
      return { error: "One half clashes with a shift that teacher already has that day." };
    }
  }

  const now = new Date().toISOString();
  const trail = `${sgDate(now)}: split at ${cut} by an admin`;
  const note = clean(row.note) ? `${clean(row.note)}\n${trail}` : trail;

  // Both writes or neither: a half-applied split leaves one class unrostered and
  // nobody looking for it. node:sqlite has no .transaction() helper — the rest
  // of this codebase drives BEGIN/COMMIT by hand (see lib/actions/admin.js) and
  // so does this.
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE shifts SET teacher_id = ?, end_time = ?, ends_at = ?, note = ?, updated_at = ? WHERE id = ?`
    ).run(firstTeacher, cut, firstHalf.endsAt, note, now, row.id);

    db.prepare(
      // position and published are carried over, not defaulted: half a shift is
      // the same work, and a split draft must not publish itself.
      `INSERT INTO shifts (id, teacher_id, category, ot_reason, ot_role, position, branch, date, start_time, end_time,
                           starts_at, ends_at, status, ph_name, unpaid, published, note, batch_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(), secondTeacher, row.category, row.ot_reason, row.ot_role, row.position, row.branch, row.date,
      cut, row.end_time, secondHalf.startsAt, secondHalf.endsAt,
      row.ph_name, row.unpaid, row.published, note, row.batch_id, session.userId, now, now
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    if (String(err?.message || "").includes("UNIQUE")) {
      return { error: "That teacher already has a shift starting at the split time." };
    }
    throw err;
  }

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true, at: cut };
}


/**
 * One shift, everything Sling's "Shift details" panel shows.
 *
 * Karim's screenshot: employee, date, time with duration and the timezone,
 * location, position, and COWORKERS — who else is on at that centre at that
 * time. The coworkers row is the one that is not on the shift's own record and
 * has to be looked up, and it is also the most useful: "who else is in the room"
 * is the question behind half the reasons somebody opens a shift.
 */
export async function shiftDetail(id) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(clean(id));
  if (!row) return { error: "Shift not found." };
  const shift = shape(row);
  const denied = refuseBranch(session, shift.branch);
  if (denied) return { error: denied };

  // Overlapping, same centre, not this shift, not cancelled. Overlap rather
  // than "same start": a coworker who arrives halfway through is still in the
  // room, and Sling counts them.
  const coworkers = db
    .prepare(
      `SELECT DISTINCT p.id, p.full_name, p.photo, p.position
       FROM shifts s JOIN profiles p ON p.id = s.teacher_id
       WHERE s.id != ? AND s.status = 'planned'
         AND s.starts_at < ? AND s.ends_at > ?
         AND ((s.branch IS NULL AND ? IS NULL) OR s.branch = ?)
       ORDER BY p.full_name`
    )
    .all(shift.id, shift.endsAt, shift.startsAt, shift.branch, shift.branch)
    .map((r) => ({ id: r.id, name: r.full_name, photo: r.photo || null, position: r.position || null }));

  const history = db
    .prepare(
      `SELECT id, actor_name, action, field, from_value, to_value, at
       FROM shift_history WHERE shift_id = ? ORDER BY at ASC`
    )
    .all(shift.id)
    .map((h) => ({
      id: h.id,
      actor: h.actor_name || "(unknown)",
      action: h.action,
      field: h.field || null,
      from: h.from_value || null,
      to: h.to_value || null,
      at: h.at,
    }));

  return { shift, coworkers, history };
}

/**
 * Publish a draft, or pull a published shift back to draft.
 *
 * The PUBLISH toggle on the New shift form would otherwise be a trap door: you
 * can save a draft, but nothing in the portal could ever publish it, so the
 * shift would sit on the admin's grid forever while the teacher never heard
 * about it.
 *
 * Unpublishing is allowed only while nothing has been worked against it. Once
 * somebody has clocked in, hiding the shift from them would hide the thing
 * their pay is calculated from.
 */
export async function setShiftPublished(id, published) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(id));
  if (!row) return { error: "Shift not found." };

  const denied = refuseBranch(session, row.branch);
  if (denied) return { error: denied };

  const want = published ? 1 : 0;
  if (row.published === want) return { ok: true, published: !!want };

  if (!want) {
    if (db.prepare("SELECT id FROM work_sessions WHERE shift_id = ?").get(row.id)) {
      return { error: "Somebody has already clocked in for this shift — it can’t go back to a draft." };
    }
    if (row.offered_at) {
      return { error: "That shift is on the relief board. Take it off the board first." };
    }
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE shifts SET published = ?, updated_at = ? WHERE id = ?").run(want, now, row.id);
  logShift(db, session, row.id, want ? "published" : "unpublished", null, want ? "draft" : "published", want ? "published" : "draft");

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true, published: !!want };
}

/**
 * Copy a shift to another date — Sling's duplicate icon.
 *
 * Same teacher, same times, same centre. Refuses a clash for the same reason
 * createShifts does, and records itself as a creation on the NEW shift rather
 * than as an edit of the old one, because that is what it is.
 */
export async function duplicateShift(id, toDate) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(id));
  if (!row) return { error: "Shift not found." };
  const denied = refuseBranch(session, row.branch);
  if (denied) return { error: denied };

  const date = clean(toDate);
  if (!YMD.test(date)) return { error: "Pick a date to copy it to." };

  const span = isoFromSgSpanning(date, row.start_time, row.end_time);
  if (!span) return { error: "Those times don’t make a valid shift on that date." };

  const sameDay = db
    .prepare("SELECT * FROM shifts WHERE teacher_id = ? AND date = ? AND status = 'planned'")
    .all(row.teacher_id, date)
    .map(shape);
  const candidate = { id: "copy", ...span, status: "planned" };
  if (findOverlaps([...sameDay, candidate]).some((pair) => pair.some((x) => x.id === "copy"))) {
    return { error: "That teacher already has a shift then." };
  }

  const now = new Date().toISOString();
  const ph = holidays(db).get(date) || null;
  const copyId = randomUUID();
  try {
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, ot_reason, ot_role, position, branch, date, start_time, end_time,
                           starts_at, ends_at, status, ph_name, unpaid, published, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      copyId, row.teacher_id, row.category, row.ot_reason, row.ot_role, row.position, row.branch, date,
      row.start_time, row.end_time, span.startsAt, span.endsAt, ph, row.unpaid, row.published, row.note,
      session.userId, now, now
    );
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) {
      return { error: "That teacher already has a shift starting at that time." };
    }
    throw err;
  }

  logShift(db, session, copyId, "created", "copied from", row.date, date);

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true, date };
}

/**
 * The New shift form, in one action.
 *
 * Replaces createShift and generateShifts as the way an admin adds anything:
 * one date or a repeat, one teacher or several, teaching or OT. Karim, 17 Sep:
 * "the add shift button change to as attached, it will be for teaching and OT
 * shift making, all fields the same" — and the Generate roster button goes,
 * which is why REPEAT has to carry its weight here.
 *
 * ATOMIC PER TEACHER, not per run, the same as the bulk generator it replaces.
 * A clash for one person must not block the other nineteen, and nobody should
 * end up with half a term rostered — so each teacher is checked in full, then
 * written in full or not at all.
 */
export async function createShifts(data) {
  const session = await requireRole(["admin"]);
  const db = getDb();

  const teacherIds = [...new Set((Array.isArray(data.teacherIds) ? data.teacherIds : []).map(clean).filter(Boolean))];
  if (!teacherIds.length) return { error: "Add at least one employee." };

  const teachers = teacherIds.map((id) =>
    db.prepare("SELECT id, full_name, position FROM profiles WHERE id = ?").get(id)
  );
  if (teachers.some((t) => !t)) return { error: "One of those employees no longer has an account." };

  const date = clean(data.date);
  const startTime = clean(data.startTime);
  const endTime = clean(data.endTime);
  if (!YMD.test(date)) return { error: "Pick a date." };
  if (!HHMM.test(startTime) || !HHMM.test(endTime)) return { error: "Enter a start and end time." };
  if (startTime === endTime) return { error: "The start and end times can’t be the same." };

  // The position decides the category and the OT team. Refused rather than
  // defaulted: an unrecognised position turning into a paid teaching shift is
  // guessing about money.
  const meaning = positionMeaning(data.position);
  if (!meaning) return { error: "Pick a position." };

  const branch = SHIFT_LOCATIONS.includes(clean(data.branch)) ? clean(data.branch) : null;
  const denied = refuseBranch(session, branch);
  if (denied) return { error: denied };

  const repeat = repeatMeaning(data.repeat);
  let dates = [date];
  let skipped = [];

  if (repeat.weeks > 0) {
    const weekdays = (Array.isArray(data.weekdays) ? data.weekdays : []).map(Number).filter((n) => n >= 0 && n <= 6);
    // Default to the day the shift itself falls on. Somebody who picked
    // "every week" and nothing else plainly means "this day, every week".
    const days = weekdays.length ? weekdays : [sgWeekday(date)];

    // "This week" ends at the Sunday of the shift's own week and never asks for
    // an until; everything else needs one.
    const until = repeat.bounded ? endOfSgWeek(date) : clean(data.repeatUntil);
    if (!YMD.test(until)) return { error: "Pick a date for the repeat to end." };
    if (until < date) return { error: "The repeat ends before it starts." };

    const built = buildShiftRows({
      fromDate: date,
      toDate: until,
      weekdays: days,
      startTime,
      endTime,
      holidays: holidays(db),
      skipHolidays: !!data.skipHolidays,
      everyWeeks: repeat.weeks,
    });
    dates = built.rows.map((r) => r.date);
    skipped = built.skipped;
    if (!dates.length) {
      return { error: "That repeat produced no shifts — check the days and the end date.", skipped };
    }
  }

  const published = data.published === false ? 0 : 1;
  const note = clean(data.note) || null;
  const now = new Date().toISOString();
  const hol = holidays(db);
  const batchId = dates.length > 1 || teacherIds.length > 1 ? randomUUID() : null;

  const insert = db.prepare(
    `INSERT INTO shifts (id, teacher_id, category, ot_reason, ot_role, position, branch, date,
                         start_time, end_time, starts_at, ends_at, status, ph_name, published,
                         note, batch_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`
  );

  const made = [];
  const clashes = [];
  // Sorted rather than assumed: the clash window below is built from the ends.
  const sortedDates = [...dates].sort();
  const bounds = [sortedDates[0], sortedDates[sortedDates.length - 1]];

  for (const teacher of teachers) {
    // Every date this teacher would get, checked against what they already
    // hold, BEFORE anything is written for them.
    // One day either side of the range: a shift may end after midnight, so the
    // row that clashes with a 00:30 start is the one dated the day BEFORE.
    // Checking only the exact dates would let that pair through.
    const existing = db
      .prepare("SELECT * FROM shifts WHERE teacher_id = ? AND status = 'planned' AND date BETWEEN ? AND ?")
      .all(teacher.id, addSgDays(bounds[0], -1), addSgDays(bounds[1], 1))
      .map(shape);

    const wanted = [];
    let clash = null;
    for (const d of dates) {
      const span = isoFromSgSpanning(d, startTime, endTime);
      if (!span) {
        clash = `${d} isn’t a valid shift with those times.`;
        break;
      }
      const candidate = { id: `new-${d}`, ...span, status: "planned" };
      if (findOverlaps([...existing, candidate]).some((pair) => pair.some((x) => x.id === candidate.id))) {
        clash = `${teacher.full_name} already has a shift on ${d}.`;
        break;
      }
      wanted.push({ date: d, ...span });
    }

    if (clash) {
      clashes.push(clash);
      continue;
    }

    db.exec("BEGIN");
    try {
      for (const w of wanted) {
        const id = randomUUID();
        insert.run(
          id, teacher.id, meaning.category,
          // ot_reason predates POSITION and is now only a display fallback for
          // the shifts made before it. "Other" is the honest value: position
          // and ot_role carry the real answer for anything made here.
          meaning.category === "ot" ? "Other" : null,
          meaning.otRole, meaning.key, branch, w.date,
          startTime, endTime, w.startsAt, w.endsAt,
          hol.get(w.date) || null, published, note, batchId, session.userId, now, now
        );
        logShift(db, session, id, "created", null, null, published ? null : "draft");
      }
      db.exec("COMMIT");
      made.push({ teacher: teacher.full_name, count: wanted.length });
    } catch (err) {
      db.exec("ROLLBACK");
      if (String(err?.message || "").includes("UNIQUE")) {
        clashes.push(`${teacher.full_name} already has a shift starting at that time.`);
        continue;
      }
      throw err;
    }
  }

  if (!made.length) {
    return { error: clashes[0] || "Nothing was created.", clashes, skipped };
  }

  revalidatePath("/admin");
  revalidatePath("/hours");
  return {
    ok: true,
    created: made.reduce((n, m) => n + m.count, 0),
    teachers: made.length,
    published: !!published,
    clashes,
    skipped,
  };
}

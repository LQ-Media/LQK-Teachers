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
import { requireSession, requireRole } from "@/lib/dal";
import { getDb, LOCATIONS } from "@/lib/db";
import { OT_REASONS, isoFromSgSpanning, sgDate, sgToday, addSgDays } from "@/lib/hours/rates";
import { buildShiftRows, findOverlaps, isMissed, shiftMinutes, MISSED_REASONS } from "@/lib/hours/shifts";
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
    category: row.category,
    otReason: row.ot_reason || null,
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
    missedReason: row.missed_reason || null,
    missedReasonAt: row.missed_reason_at || null,
    resolution: row.resolution || null,
    note: row.note || null,
    batchId: row.batch_id || null,
    sessionId: row.session_id ?? null,
    minutes: shiftMinutes({ startsAt: row.starts_at, endsAt: row.ends_at }),
  };
}

// Shifts joined to whichever session (if any) fulfilled them. LEFT JOIN, so an
// unworked shift still appears — that is the whole point of the missed report.
const SELECT = `
  SELECT s.*, p.full_name AS teacher_name, p.pay_tier AS pay_tier, w.id AS session_id
  FROM shifts s
  JOIN profiles p ON p.id = s.teacher_id
  LEFT JOIN work_sessions w ON w.shift_id = s.id
`;

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

export async function createShift(data) {
  const session = await requireRole(["admin"]);
  const db = getDb();

  const teacherId = clean(data.teacherId);
  const date = clean(data.date);
  const startTime = clean(data.startTime);
  const endTime = clean(data.endTime);
  const category = data.category === "ot" ? "ot" : "teaching";

  const bad = validate({ date, startTime, endTime, category });
  if (bad) return { error: bad };

  const teacher = db.prepare("SELECT id, pay_tier FROM profiles WHERE id = ?").get(teacherId);
  if (!teacher) return { error: "Pick a teacher." };

  const span = isoFromSgSpanning(date, startTime, endTime);
  if (!span) return { error: "Those times don’t make a valid shift." };

  // Clashes are caught HERE, when an admin is rostering and can still fix it —
  // not at clock-in, when it is far too late and the teacher is the wrong
  // person to tell about a rostering mistake.
  const sameDay = db
    .prepare("SELECT * FROM shifts WHERE teacher_id = ? AND date = ? AND status = 'planned'")
    .all(teacherId, date)
    .map(shape);
  const candidate = { id: "new", ...span, status: "planned" };
  if (findOverlaps([...sameDay, candidate]).some((pair) => pair.some((s) => s.id === "new"))) {
    return { error: "That clashes with a shift this teacher already has that day." };
  }

  const now = new Date().toISOString();
  const branch = LOCATIONS.includes(clean(data.branch)) ? clean(data.branch) : null;
  const ph = holidays(db).get(date) || null;

  try {
    db.prepare(
      `INSERT INTO shifts (id, teacher_id, category, ot_reason, branch, date, start_time, end_time,
                           starts_at, ends_at, status, ph_name, unpaid, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(), teacherId, category,
      category === "ot" && OT_REASONS.includes(clean(data.otReason)) ? clean(data.otReason) : category === "ot" ? "Other" : null,
      branch, date, startTime, endTime, span.startsAt, span.endsAt,
      ph, data.unpaid ? 1 : 0, clean(data.note) || null, session.userId, now, now
    );
  } catch (err) {
    if (String(err?.message || "").includes("UNIQUE")) {
      return { error: "That teacher already has a shift starting at that time." };
    }
    throw err;
  }

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true, phName: ph };
}

export async function editShift(data) {
  await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare("SELECT * FROM shifts WHERE id = ?").get(clean(data.id));
  if (!row) return { error: "Shift not found." };

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
  const branch = LOCATIONS.includes(clean(data.branch)) ? clean(data.branch) : row.branch;
  const ph = holidays(db).get(date) || null;

  db.prepare(
    `UPDATE shifts SET branch = ?, date = ?, start_time = ?, end_time = ?, starts_at = ?, ends_at = ?,
                       ph_name = ?, unpaid = ?, note = ?, updated_at = ? WHERE id = ?`
  ).run(
    branch, date, startTime, endTime, span.startsAt, span.endsAt, ph,
    data.unpaid ? 1 : 0, clean(data.note) || null, now, row.id
  );

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
  const row = db.prepare("SELECT id FROM shifts WHERE id = ?").get(clean(id));
  if (!row) return { error: "Shift not found." };

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE shifts SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?"
  ).run(clean(reason) || "cancelled", session.userId, now, now, row.id);

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

  const b = LOCATIONS.includes(clean(branch)) ? clean(branch) : null;
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

/**
 * Bulk-generate a recurring roster. Materialised one row per occurrence — the
 * weekly missed report is "shifts with no session", which is one join over real
 * rows, and each occurrence needs its own state anyway (cancelled, reason
 * given, resolved). A rule plus an exceptions table is the same thing with more
 * moving parts.
 *
 * Nothing is written unless the whole set is clash-free, so a bad run can't
 * leave a half-applied roster behind. `batchId` is the undo handle.
 */
export async function generateShifts(data) {
  const session = await requireRole(["admin"]);
  const db = getDb();

  // Accepts a list, and still accepts a single teacherId so nothing that called
  // the old shape breaks.
  const teacherIds = [...new Set(
    (Array.isArray(data.teacherIds) ? data.teacherIds : [data.teacherId]).map(clean).filter(Boolean)
  )];
  if (!teacherIds.length) return { error: "Pick at least one teacher." };

  const teachers = teacherIds
    .map((id) => db.prepare("SELECT id, full_name FROM profiles WHERE id = ?").get(id))
    .filter(Boolean);
  if (teachers.length !== teacherIds.length) return { error: "One of those teachers no longer has an account." };

  const fromDate = clean(data.fromDate);
  const toDate = clean(data.toDate);
  const startTime = clean(data.startTime);
  const endTime = clean(data.endTime);
  const weekdays = (Array.isArray(data.weekdays) ? data.weekdays : []).map(Number).filter((n) => n >= 0 && n <= 6);

  if (!YMD.test(fromDate) || !YMD.test(toDate)) return { error: "Pick a valid date range." };
  if (fromDate > toDate) return { error: "The end date is before the start date." };
  if (!HHMM.test(startTime) || !HHMM.test(endTime)) return { error: "Enter start and end times as HH:MM." };
  if (startTime === endTime) return { error: "The start and end times can’t be the same." };
  if (!weekdays.length) return { error: "Pick at least one day of the week." };

  const category = data.category === "ot" ? "ot" : "teaching";
  const branch = LOCATIONS.includes(clean(data.branch)) ? clean(data.branch) : null;
  const { rows, skipped } = buildShiftRows({
    fromDate, toDate, weekdays, startTime, endTime,
    holidays: holidays(db),
    skipHolidays: !!data.skipHolidays,
  });
  if (!rows.length) return { error: "That range produced no shifts.", skipped };

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO shifts (id, teacher_id, category, ot_reason, branch, date, start_time, end_time,
                         starts_at, ends_at, status, ph_name, unpaid, note, batch_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`
  );

  // Atomicity is PER TEACHER, not per run. A clash for one person shouldn't
  // block the other nineteen, but nobody should end up with half a term
  // rostered either — so each teacher is checked in full first, and either
  // gets all their shifts or none of them.
  const done = [];
  const clashed = [];
  let created = 0;
  let duplicates = 0;

  for (const teacher of teachers) {
    const existing = db
      .prepare("SELECT * FROM shifts WHERE teacher_id = ? AND status = 'planned' AND date BETWEEN ? AND ?")
      .all(teacher.id, fromDate, addSgDays(toDate, 1))
      .map(shape);

    const dates = [];
    for (const r of rows) {
      const candidate = { id: `new:${r.date}`, startsAt: r.startsAt, endsAt: r.endsAt, status: "planned" };
      const sameDay = existing.filter((e) => e.date === r.date || e.date === addSgDays(r.date, -1));
      if (findOverlaps([...sameDay, candidate]).some((pair) => pair.some((s) => s.id === candidate.id))) {
        dates.push(r.date);
      }
    }
    if (dates.length) {
      clashed.push({ name: teacher.full_name, dates });
      continue;
    }

    let mine = 0;
    for (const r of rows) {
      try {
        insert.run(
          randomUUID(), teacher.id, category, null, branch, r.date, startTime, endTime,
          r.startsAt, r.endsAt, r.phName, data.unpaid ? 1 : 0, clean(data.note) || null,
          batchId, session.userId, now, now
        );
        mine += 1;
      } catch (err) {
        // The unique index caught a re-submitted form — an idempotent no-op,
        // not a failure.
        if (String(err?.message || "").includes("UNIQUE")) duplicates += 1;
        else throw err;
      }
    }
    created += mine;
    done.push({ name: teacher.full_name, created: mine });
  }

  if (!done.length) {
    return {
      error: `Nothing was created — every teacher selected already has something clashing (${clashed
        .map((c) => c.name)
        .slice(0, 3)
        .join(", ")}${clashed.length > 3 ? "…" : ""}).`,
      clashed,
    };
  }

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true, created, duplicates, skipped, batchId, done, clashed };
}

/** Undo a bulk generation. Anything already worked is kept and reported. */
export async function deleteBatch(batchId) {
  await requireRole(["admin"]);
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
  await requireRole(["admin"]);
  const db = getDb();
  const from = YMD.test(clean(fromDate)) ? clean(fromDate) : sgToday();
  const to = YMD.test(clean(toDate)) ? clean(toDate) : addSgDays(from, 13);

  const rows = db
    .prepare(`${SELECT} WHERE s.date BETWEEN ? AND ? ORDER BY s.date ASC, s.starts_at ASC`)
    .all(from, to)
    .map(shape);

  return { from, to, shifts: rows };
}

/**
 * The weekly exception list that replaces the manual chase: shifts nobody
 * clocked in for, still unresolved. Cancelled and already-resolved shifts are
 * excluded, so a rejected explanation is never asked about twice.
 */
export async function missedShifts(fromDate, toDate) {
  await requireRole(["admin"]);
  const db = getDb();
  const now = new Date().toISOString();
  const from = YMD.test(clean(fromDate)) ? clean(fromDate) : addSgDays(sgToday(), -7);
  const to = YMD.test(clean(toDate)) ? clean(toDate) : sgToday();

  const rows = db
    .prepare(`${SELECT} WHERE s.date BETWEEN ? AND ? ORDER BY s.date DESC, s.starts_at ASC`)
    .all(from, to)
    .map(shape)
    .filter((s) => isMissed(s, now, !!s.sessionId));

  return { from, to, missed: rows };
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
  await requireRole(["admin"]);
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

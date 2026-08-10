"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession, requireRole } from "@/lib/dal";
import { getDb, LOCATIONS } from "@/lib/db";
import {
  OT_REASONS,
  OT_RATE,
  teachingRate,
  rateFor,
  isoFromSg,
  minutesBetween,
  sgMonth,
  payCents,
  isLongSession,
} from "@/lib/hours/rates";
import { parseFix, reverseGeocode } from "@/lib/hours/geo";

function clean(v) {
  return String(v ?? "").trim();
}

// Turn a device fix into the columns we store, resolving a place name as we go.
// A failed lookup is fine — the coordinates are the record, the label is a
// courtesy for whoever reads payroll.
async function geoColumns(raw) {
  const fix = parseFix(raw);
  if (!fix) return null;
  return {
    ...fix,
    label: await reverseGeocode(fix.lat, fix.lng),
    at: new Date().toISOString(),
  };
}

// Resolve a submitted branch to a known location, else fall back to the
// teacher's primary branch (may be null for HQ).
function resolveBranch(raw, primary) {
  const b = clean(raw);
  if (LOCATIONS.includes(b)) return b;
  return primary || null;
}

function normalizeCategory(raw) {
  return raw === "ot" ? "ot" : "teaching";
}

function normalizeReason(category, raw) {
  if (category !== "ot") return null;
  const r = clean(raw);
  return OT_REASONS.includes(r) ? r : "Other";
}

// Shape a DB row into a plain object safe to hand to Client Components
// (node:sqlite rows have a null prototype — see AGENTS/CLAUDE notes).
// The location stamp, or null when the session was never tagged.
function toGeo(row) {
  if (row.geo_lat == null || row.geo_lng == null) return null;
  return {
    lat: row.geo_lat,
    lng: row.geo_lng,
    accuracy: row.geo_accuracy ?? null,
    label: row.geo_label || null,
    at: row.geo_at || null,
  };
}

function toSession(row) {
  if (!row) return null;
  const minutes = row.ended_at ? minutesBetween(row.started_at, row.ended_at) : null;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name ?? null,
    payTier: row.pay_tier ?? null,
    category: row.category,
    otReason: row.ot_reason || null,
    branch: row.branch || null,
    startedAt: row.started_at,
    endedAt: row.ended_at || null,
    note: row.note || null,
    status: row.status,
    rateCents: row.rate_cents ?? null,
    reviewerNote: row.reviewer_note || null,
    geo: toGeo(row),
    minutes,
    running: !row.ended_at,
    long: isLongSession(row.started_at, row.ended_at),
  };
}

// ---- Teacher: clock in / out ------------------------------------------

export async function clockIn(data) {
  const session = await requireSession();
  const db = getDb();
  const uid = session.userId;

  const running = db.prepare("SELECT id FROM work_sessions WHERE teacher_id = ? AND ended_at IS NULL").get(uid);
  if (running) return { error: "You’re already clocked in. Clock out first." };

  const category = normalizeCategory(data.category);
  const otReason = normalizeReason(category, data.otReason);
  const branch = resolveBranch(data.branch, session.primaryLocation);
  const geo = await geoColumns(data.geo);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO work_sessions (id, teacher_id, category, ot_reason, branch, started_at, ended_at, note, status,
                                geo_lat, geo_lng, geo_accuracy, geo_label, geo_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    uid,
    category,
    otReason,
    branch,
    now,
    clean(data.note) || null,
    geo?.lat ?? null,
    geo?.lng ?? null,
    geo?.accuracy ?? null,
    geo?.label ?? null,
    geo?.at ?? null,
    now,
    now
  );

  revalidatePath("/hours");
  return { ok: true };
}

export async function clockOut() {
  const session = await requireSession();
  const db = getDb();
  const running = db.prepare("SELECT * FROM work_sessions WHERE teacher_id = ? AND ended_at IS NULL").get(session.userId);
  if (!running) return { error: "You’re not clocked in." };

  const now = new Date().toISOString();
  db.prepare("UPDATE work_sessions SET ended_at = ?, updated_at = ? WHERE id = ?").run(now, now, running.id);

  revalidatePath("/hours");
  return { ok: true, long: isLongSession(running.started_at, now) };
}

/**
 * Name a fix so the teacher can see where they're about to tag before they
 * commit to it. Nothing is written — the label is resolved (and cached) here and
 * resolved again from the coordinates when the session is actually saved, so a
 * client can never dictate the stored label.
 */
export async function describeLocation(fix) {
  await requireSession();
  const parsed = parseFix(fix);
  if (!parsed) return { error: "That location reading was too vague to use. Try again outdoors or with Wi-Fi on." };
  return { ok: true, label: await reverseGeocode(parsed.lat, parsed.lng), accuracy: parsed.accuracy };
}

// ---- Teacher: manual entry / edit / delete ----------------------------

// Build + validate the start/end instants for a manual or edited session.
function buildTimes(data) {
  const date = clean(data.date);
  const startedAt = isoFromSg(date, clean(data.start));
  const endedAt = isoFromSg(date, clean(data.end));
  if (!startedAt || !endedAt) return { error: "Enter a valid date, start and end time." };
  if (new Date(endedAt) <= new Date(startedAt)) return { error: "End time must be after the start time." };
  if (minutesBetween(startedAt, endedAt) > 24 * 60) return { error: "A session can’t be longer than 24 hours." };
  return { startedAt, endedAt };
}

export async function addPastSession(data) {
  const session = await requireSession();
  const db = getDb();

  const times = buildTimes(data);
  if (times.error) return { error: times.error };

  const category = normalizeCategory(data.category);
  const otReason = normalizeReason(category, data.otReason);
  const branch = resolveBranch(data.branch, session.primaryLocation);
  const geo = await geoColumns(data.geo);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO work_sessions (id, teacher_id, category, ot_reason, branch, started_at, ended_at, note, status,
                                geo_lat, geo_lng, geo_accuracy, geo_label, geo_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    session.userId,
    category,
    otReason,
    branch,
    times.startedAt,
    times.endedAt,
    clean(data.note) || null,
    geo?.lat ?? null,
    geo?.lng ?? null,
    geo?.accuracy ?? null,
    geo?.label ?? null,
    geo?.at ?? null,
    now,
    now
  );

  revalidatePath("/hours");
  revalidatePath("/admin");
  return { ok: true };
}

// Load a session and check the caller may modify it: owners may edit their own
// while still pending; admins may edit anything.
async function loadEditable(id) {
  const session = await requireSession();
  const db = getDb();
  const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(clean(id));
  if (!row) return { error: "Session not found." };
  const isAdmin = session.role === "admin";
  const isOwner = row.teacher_id === session.userId;
  if (!isAdmin && !isOwner) return { error: "You can’t change this session." };
  if (!isAdmin && row.status !== "pending") {
    return { error: "This session has already been reviewed — ask an admin to change it." };
  }
  return { db, session, row, isAdmin };
}

export async function editSession(data) {
  const ctx = await loadEditable(data.id);
  if (ctx.error) return { error: ctx.error };
  const { db, row } = ctx;

  const times = buildTimes(data);
  if (times.error) return { error: times.error };

  const category = normalizeCategory(data.category);
  const otReason = normalizeReason(category, data.otReason);
  const branch = resolveBranch(data.branch, null) || row.branch;
  const now = new Date().toISOString();

  // A location stamp survives an edit untouched unless the form says otherwise:
  // `geo` re-stamps it (a fresh fix from the device), `clearGeo` removes it.
  let geoSql = "";
  const geoArgs = [];
  if (data.clearGeo) {
    geoSql = ", geo_lat = NULL, geo_lng = NULL, geo_accuracy = NULL, geo_label = NULL, geo_at = NULL";
  } else {
    const geo = await geoColumns(data.geo);
    if (geo) {
      geoSql = ", geo_lat = ?, geo_lng = ?, geo_accuracy = ?, geo_label = ?, geo_at = ?";
      geoArgs.push(geo.lat, geo.lng, geo.accuracy, geo.label, geo.at);
    }
  }

  db.prepare(
    `UPDATE work_sessions
     SET category = ?, ot_reason = ?, branch = ?, started_at = ?, ended_at = ?, note = ?${geoSql}, updated_at = ?
     WHERE id = ?`
  ).run(category, otReason, branch, times.startedAt, times.endedAt, clean(data.note) || null, ...geoArgs, now, row.id);

  revalidatePath("/hours");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Stamp (or clear) the location on an existing session without touching
 * anything else — how a teacher tags the session they're currently clocked into,
 * where there's no form to submit. Pass a null fix to remove the stamp.
 */
export async function setSessionLocation(id, fix) {
  const ctx = await loadEditable(id);
  if (ctx.error) return { error: ctx.error };
  const { db, row } = ctx;
  const now = new Date().toISOString();

  if (!fix) {
    db.prepare(
      `UPDATE work_sessions
       SET geo_lat = NULL, geo_lng = NULL, geo_accuracy = NULL, geo_label = NULL, geo_at = NULL, updated_at = ?
       WHERE id = ?`
    ).run(now, row.id);
    revalidatePath("/hours");
    revalidatePath("/admin");
    return { ok: true, geo: null };
  }

  const geo = await geoColumns(fix);
  if (!geo) return { error: "That location reading was too vague to save. Try again outdoors or with Wi-Fi on." };

  db.prepare(
    `UPDATE work_sessions
     SET geo_lat = ?, geo_lng = ?, geo_accuracy = ?, geo_label = ?, geo_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(geo.lat, geo.lng, geo.accuracy, geo.label, geo.at, now, row.id);

  revalidatePath("/hours");
  revalidatePath("/admin");
  return { ok: true, geo: { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, label: geo.label, at: geo.at } };
}

export async function deleteSession(id) {
  const ctx = await loadEditable(id);
  if (ctx.error) return { error: ctx.error };
  ctx.db.prepare("DELETE FROM work_sessions WHERE id = ?").run(ctx.row.id);
  revalidatePath("/hours");
  revalidatePath("/admin");
  return { ok: true };
}

// ---- Admin: approve / reject ------------------------------------------

export async function approveSession(id) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(clean(id));
  if (!row) return { error: "Session not found." };
  if (!row.ended_at) return { error: "This session is still running — it can’t be approved yet." };

  let rate;
  if (row.category === "ot") {
    rate = OT_RATE;
  } else {
    const prof = db.prepare("SELECT full_name, pay_tier FROM profiles WHERE id = ?").get(row.teacher_id);
    rate = teachingRate(prof?.pay_tier);
    if (rate == null) {
      return { error: `Set ${prof?.full_name || "this teacher"}’s pay tier before approving teaching hours.` };
    }
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE work_sessions SET status = 'approved', rate_cents = ?, reviewer_id = ?, reviewer_note = NULL, reviewed_at = ?, updated_at = ? WHERE id = ?"
  ).run(Math.round(rate * 100), session.userId, now, now, row.id);

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true };
}

export async function rejectSession(id, note) {
  const session = await requireRole(["admin"]);
  const db = getDb();
  const row = db.prepare("SELECT id FROM work_sessions WHERE id = ?").get(clean(id));
  if (!row) return { error: "Session not found." };

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE work_sessions SET status = 'rejected', rate_cents = NULL, reviewer_id = ?, reviewer_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?"
  ).run(session.userId, clean(note) || null, now, now, row.id);

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true };
}

// ---- Admin: payroll data (pending queue + monthly summary) -------------

const ADMIN_SELECT = `
  SELECT w.*, p.full_name AS teacher_name, p.pay_tier AS pay_tier
  FROM work_sessions w JOIN profiles p ON p.id = w.teacher_id
`;

// Everything an admin needs to review + total a month, in one call so the
// month picker can refetch without a full page reload.
export async function hoursAdminData(month) {
  await requireRole(["admin"]);
  const db = getDb();

  // Pending queue: all completed, not-yet-reviewed sessions (any month).
  const pending = db
    .prepare(`${ADMIN_SELECT} WHERE w.ended_at IS NOT NULL AND w.status = 'pending' ORDER BY w.started_at ASC`)
    .all()
    .map(toSession);

  // Monthly summary: every completed, non-rejected session that falls in `month`.
  const rows = db
    .prepare(`${ADMIN_SELECT} WHERE w.ended_at IS NOT NULL AND w.status != 'rejected' ORDER BY w.started_at ASC`)
    .all()
    .filter((r) => sgMonth(r.started_at) === month);

  const byTeacher = new Map();
  for (const r of rows) {
    const s = toSession(r);
    let t = byTeacher.get(s.teacherId);
    if (!t) {
      t = {
        teacherId: s.teacherId,
        teacherName: r.teacher_name,
        payTier: r.pay_tier || null,
        teachingMinutes: 0,
        otMinutes: 0,
        approvedCents: 0,
        pendingCents: 0,
        pendingCount: 0,
      };
      byTeacher.set(s.teacherId, t);
    }
    if (s.category === "ot") t.otMinutes += s.minutes;
    else t.teachingMinutes += s.minutes;

    if (s.status === "approved") {
      // Use the snapshotted rate; fall back to current rate if somehow missing.
      const rate = s.rateCents != null ? s.rateCents / 100 : rateFor(s.category, r.pay_tier);
      t.approvedCents += payCents(s.minutes, rate);
    } else {
      t.pendingCents += payCents(s.minutes, rateFor(s.category, r.pay_tier));
      t.pendingCount += 1;
    }
  }

  const summary = [...byTeacher.values()].sort((a, b) => a.teacherName.localeCompare(b.teacherName));
  return { month, pending, summary };
}

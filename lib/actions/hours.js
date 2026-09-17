"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession, requireRole, requireFullAdmin, canManageBranch, managedBranches } from "@/lib/dal";
import { getDb, LOCATIONS } from "@/lib/db";
import {
  OT_REASONS,
  OT_RATE,
  PH_MULTIPLIER,
  teachingRate,
  isoFromSg,
  minutesBetween,
  sgDate,
  isLongSession,
} from "@/lib/hours/rates";
import { parseFix, reverseGeocode } from "@/lib/hours/geo";
import { shiftsRealisedBy, isOnShift, shiftMinutes } from "@/lib/hours/shifts";
import { payableWindow, roundClockIn } from "@/lib/hours/attendance";
import { locationForBranch, checkGeofence } from "@/lib/hours/locations";
import { hydrate, geofenceEnabled } from "@/lib/hours/geocode";
import { summariseSessions } from "@/lib/hours/payroll";

/**
 * A session is only payable once the work has actually happened.
 *
 * This used to be plain `ended_at IS NOT NULL`, which was safe while ended_at
 * was written at clock-OUT. A rostered session copies its shift's window at
 * clock-IN, so ended_at now sits in the FUTURE for the whole shift — and every
 * reader that meant "this is done" would otherwise happily export it, total it,
 * and let an admin approve and pay tomorrow's class today.
 *
 * Use this everywhere ended_at was previously tested. Bind :now to an ISO
 * instant.
 *
 * Not exported: this file carries "use server", so every export must be an
 * async server action. The same predicate is written out inline in the other
 * readers — app/(portal)/hours/page.js, app/(portal)/dashboard/page.js and
 * app/api/hours/export/route.js — each with a comment pointing back here.
 */
const PAYABLE_SQL = "w.ended_at IS NOT NULL AND w.ended_at <= :now";

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

/**
 * What a teacher reads when the fence refuses. Returns null to ALLOW.
 *
 * The refusals are kept apart because they are different situations and need
 * different words in front of somebody standing in their classroom unable to
 * start their shift. Two of the five allow through, deliberately:
 *
 *   too_far        REFUSE. We know where they are and it is not here. The one
 *                  case the fence exists for.
 *   unknown_branch REFUSE. The shift's branch is not a place we recognise, so
 *                  we cannot vouch for anything. An admin has to fix the shift.
 *   no_coords      REFUSE. We never resolved this centre. Their morning, our
 *                  bug — so the message says so rather than implying they are
 *                  in the wrong place, and it must reach an admin.
 *   no_fix         ALLOW. The phone could not get a location. Every centre is
 *                  on an upper floor of an office block, which is exactly where
 *                  GPS is worst; refusing would dock a teacher's pay for their
 *                  building's concrete. Recorded on the session, so an IT Head
 *                  can see a pattern if one develops.
 *   unfenced       ALLOW. HQ, Outside LQK, Online, or a shift with no branch —
 *                  nothing to check against by design.
 */
function geofenceRefusal(verdict, branch) {
  const where = branch || "this shift";
  switch (verdict.reason) {
    case "too_far": {
      const km = verdict.metres >= 1000 ? `${(verdict.metres / 1000).toFixed(1)} km` : `${Math.round(verdict.metres)} m`;
      return (
        `You look about ${km} from ${where}, so the clock-in didn’t go through. ` +
        `If you are at the centre, check your phone’s location is on and try again, ` +
        `then tell your IT Head if it still won’t.`
      );
    }
    case "unknown_branch":
      return `This shift’s location (${where}) isn’t set up for clocking in. Tell your IT Head — they’ll fix the shift.`;
    case "no_coords":
      return `We haven’t finished setting up the location check for ${where}. That’s our end, not yours — tell your IT Head and clock in once they’ve sorted it.`;
    default:
      return null; // no_fix, unfenced, inside
  }
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

function toSession(row, nowIso = new Date().toISOString()) {
  if (!row) return null;
  const minutes = row.ended_at ? minutesBetween(row.started_at, row.ended_at) : null;
  const session = {
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
    // Rostered attendance. shiftId NULL means unscheduled or pre-roster legacy.
    shiftId: row.shift_id || null,
    clockInAt: row.clock_in_at || null,
    clockOutAt: row.clock_out_at || null,
    source: row.source || "legacy",
    phName: row.ph_name || null,
    phMultiplier: row.ph_multiplier ?? null,
    // Only an unscheduled tap is ever left running now — a rostered session
    // knows when it ends the moment it starts.
    running: !row.ended_at,
    // "Has finished", not "has an end time". See PAYABLE_SQL.
    payable: !!row.ended_at && new Date(row.ended_at) <= new Date(nowIso),
    // A rostered shift is expected to look however the roster says, so the
    // "Check times" warning would fire on every legitimate late class.
    long: row.shift_id ? false : isLongSession(row.started_at, row.ended_at),
  };
  session.onShift = isOnShift(session, nowIso);
  return session;
}

/** Shape a shifts row for a Client Component (node:sqlite rows are null-prototype). */
function toShift(row) {
  if (!row) return null;
  return {
    id: row.id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name ?? null,
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
    resolution: row.resolution || null,
    note: row.note || null,
    otRole: row.ot_role || null,
    minutes: shiftMinutes({ startsAt: row.starts_at, endsAt: row.ends_at }),
  };
}

// ---- Teacher: clock in / out ------------------------------------------

/**
 * Clock in. One tap is the entire teacher-facing action.
 *
 * The tap must match a rostered shift. A session is created per shift in that
 * shift's continuous BLOCK — a teacher who taps once before three back-to-back
 * classes has worked all three — and each one's started_at is its PAYABLE start:
 * the scheduled start, or the tap if they were late. ended_at is always the
 * scheduled end, because there is no clock-out.
 *
 * So the tap decides pay now, where it used to be only a record. Two columns
 * keep that honest: clock_in_at is the operative value an IT Head may later
 * adjust, and clock_in_original_at is what was actually tapped, written once and
 * never rewritten.
 *
 * With no rostered shift the tap is REFUSED, matching Sling. See the branch
 * below for why that is now a requirement rather than a preference.
 */
export async function clockIn(data) {
  const session = await requireSession();
  const db = getDb();
  const uid = session.userId;
  const now = new Date().toISOString();

  // Resolve the geo fix BEFORE the duplicate check. reverseGeocode does network
  // I/O, and awaiting between "is there already one?" and the INSERT left a
  // multi-hundred-millisecond window in which a double tap could produce two
  // rows. Check and write are now one synchronous block.
  const geo = await geoColumns(data.geo);

  const today = sgDate(now);
  const shifts = db
    // published = 1: an unpublished shift is a draft, and a draft cannot be
    // clocked in against. Without this the PUBLISH toggle would hide the shift
    // from the roster while still paying for it, which is the worst of both.
    .prepare("SELECT * FROM shifts WHERE teacher_id = ? AND date = ? AND status = 'planned' AND published = 1")
    .all(uid, today)
    .map(toShift);
  const due = shiftsRealisedBy(shifts, now);

  if (!due.length) {
    // No shift, no clock-in. This matches Sling, where "clock in without a
    // scheduled shift" is switched off, and it is now REQUIRED rather than
    // merely consistent: pay runs from the scheduled start to the scheduled
    // end, and an unscheduled session has neither. Under the old rules it
    // opened a session with a NULL ended_at for an admin to close; with the
    // teacher-facing clock-out gone, that row could never be closed at all.
    //
    // The recovery path is the roster, not a free-form session: if a teacher
    // really is teaching something nobody rostered, an IT Head adds the shift
    // and the hours follow from it.
    return {
      error:
        "You don’t have a shift starting now, so there’s nothing to clock in to. Tell your IT Head and they’ll add the shift.",
    };
  }

  // The geofence.
  //
  // Checked against the SHIFT's branch, not the teacher's home branch — a
  // teacher can be rostered across centres, and the fence is asked whether they
  // are where the class is.
  //
  // `locationForBranch` returns null for a branch string nobody recognises.
  // That is NOT treated as "no fence": an unrecognised branch is a data problem,
  // and the safe reading of a data problem is that we cannot vouch for the
  // location. It refuses the same as an unresolved centre does.
  //
  // The verdict is recorded on every session whether or not the fence is
  // switched on, so the real distances from real taps can be read back before
  // anybody throws a switch that can stop people starting work.
  const fenceBranch = due[0]?.branch ?? null;
  const location = locationForBranch(fenceBranch);
  const verdict = location
    ? checkGeofence(hydrate(location), geo)
    : { ok: false, reason: "unknown_branch", metres: null };

  if (!verdict.ok && geofenceEnabled()) {
    const refusal = geofenceRefusal(verdict, fenceBranch);
    // A phone that cannot get a fix is a hardware problem, not a teacher
    // standing in the wrong place — and every centre is on an upper floor of an
    // office block, which is exactly where GPS is worst. Blocking pay for it
    // would punish the teacher for their building. Recorded, never refused.
    if (refusal) return { error: refusal };
  }

  // Rostered. The partial unique index on shift_id is the real guard against a
  // double tap — the old "nothing running" check cannot see a rostered session,
  // because it is created already closed.
  const already = db
    .prepare(`SELECT shift_id FROM work_sessions WHERE shift_id IN (${due.map(() => "?").join(",")})`)
    .all(...due.map((s) => s.id));
  if (already.length) {
    const done = new Set(already.map((r) => r.shift_id));
    if (due.every((s) => done.has(s.id))) {
      return { error: "You’ve already clocked in for this class." };
    }
  }

  const insert = db.prepare(
    `INSERT INTO work_sessions (id, teacher_id, category, ot_reason, branch, started_at, ended_at, note, status,
                                geo_lat, geo_lng, geo_accuracy, geo_label, geo_at, geo_fence, geo_fence_m,
                                shift_id, clock_in_at, clock_in_original_at, source, created_by, ph_name,
                                created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'clock_in', ?, ?, ?, ?)`
  );

  // Rounded to 5 minutes, as Sling does, so the roster and the timesheet agree
  // on what 7:33 was. Rounded ONCE here, and both the operative clock-in and
  // the untouchable original are written from the same value.
  const tap = roundClockIn(now);

  let created = 0;
  for (const s of due) {
    if (already.some((r) => r.shift_id === s.id)) continue;

    // Pay runs from the scheduled start, or from the tap if they were late,
    // through to the scheduled end. For the second shift of a back-to-back
    // block the tap is earlier than its start, so it simply pays in full —
    // one tap covers the block, which is the point of blocksOf().
    const window = payableWindow(s, tap);
    if (!window) continue; // tapped after this shift had already ended

    try {
      insert.run(
        randomUUID(), uid, s.category, s.otReason, s.branch,
        window.startsAt, window.endsAt, clean(data.note) || null,
        geo?.lat ?? null, geo?.lng ?? null, geo?.accuracy ?? null, geo?.label ?? null, geo?.at ?? null,
        verdict.reason, verdict.metres == null ? null : Math.round(verdict.metres),
        s.id, tap, tap, uid, s.phName, now, now
      );
      created += 1;
    } catch (err) {
      // The unique index fired — someone tapped twice in the same instant.
      // That is exactly what it is for; treat it as a no-op, not an error.
      if (!String(err?.message || "").includes("UNIQUE")) throw err;
    }
  }

  if (!created) return { error: "You’ve already clocked in for this class." };

  revalidatePath("/hours");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, shifts: due.length };
}

/**
 * Close a legacy open session. ADMIN ONLY.
 *
 * Teachers no longer have a clock-out at all — Karim, 16 Sep 2026. Pay runs to
 * the scheduled end, and letting somebody end their own shift is letting them
 * edit their own pay. Clocking in without a roster is blocked too, so no NEW
 * row can be left open.
 *
 * What remains is history: sessions opened under the old rules that still carry
 * a NULL ended_at. Somebody has to be able to close those, and it is not the
 * teacher whose pay it is. The end time is given explicitly rather than taken
 * from the clock, because these are by definition stale — "now" would bill
 * whatever has elapsed since, which for an abandoned row could be weeks.
 */
export async function closeOpenSession(sessionId, endTimeIso) {
  await requireFullAdmin();
  const db = getDb();
  const now = new Date().toISOString();

  const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(clean(sessionId));
  if (!row) return { error: "Session not found." };
  if (row.ended_at) return { error: "That session is already closed." };
  if (row.status === "approved") return { error: "That session is approved — its pay is already settled." };

  const end = clean(endTimeIso);
  if (!end || Number.isNaN(Date.parse(end))) return { error: "Give the time it actually ended." };
  if (new Date(end) <= new Date(row.started_at)) return { error: "The end has to be after the start." };
  if (new Date(end) > new Date(now)) return { error: "That end time is in the future." };

  db.prepare("UPDATE work_sessions SET ended_at = ?, clock_out_at = ?, updated_at = ? WHERE id = ?")
    .run(end, end, now, row.id);

  revalidatePath("/hours");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, long: isLongSession(row.started_at, end) };
}

/**
 * Move a clock-in. ADMIN ONLY, and the one sanctioned way a shift's pay changes
 * after the fact.
 *
 * This is the other half of the weekly loop the IT Heads already run: they ask
 * why somebody was late or never tapped, and once they have the answer they
 * decide whether it should cost that teacher the time. Before, that decision
 * happened in a spreadsheet. Here it moves the number that actually pays, and
 * leaves the reason attached to it.
 *
 * Three things this deliberately does NOT do:
 *
 *   - It never touches clock_in_original_at. The teacher's real tap is the
 *     evidence behind every adjustment, and overwriting it would destroy the
 *     only record that anybody was ever late.
 *   - It never moves the END. That is the roster's, and the whole reason there
 *     is no clock-out.
 *   - It refuses once a session is APPROVED. Approved pay is settled; reopening
 *     it silently is how a month that was signed off stops matching the payslip
 *     that went with it.
 *
 * `reason` is required. An adjustment with no stated reason is indistinguishable
 * from someone quietly topping up their own hours.
 */
export async function adjustClockIn(sessionId, clockInIso, reason) {
  const admin = await requireRole(["admin"]);
  const db = getDb();
  const now = new Date().toISOString();

  const why = clean(reason);
  if (why.length < 3) return { error: "Say why this is being changed — it goes on the record." };

  const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(clean(sessionId));
  if (!row) return { error: "Session not found." };
  if (row.status === "approved") {
    return { error: "That session is already approved. Reject it first if the hours are wrong." };
  }
  if (!row.shift_id) return { error: "Only a rostered shift can have its clock-in adjusted." };

  const shift = db.prepare("SELECT * FROM shifts WHERE id = ?").get(row.shift_id);
  if (!shift) return { error: "The shift behind this session is missing." };

  // A centre IT Head may adjust, but only at their own centres — Karim, 16 Sep
  // 2026. The branch check is on the SHIFT, not on the teacher: a teacher can
  // be rostered across centres, and it is the shift being paid.
  if (!canManageBranch(admin.userId, shift.branch)) {
    const mine = managedBranches(admin.userId);
    return {
      error: mine && !mine.length
        ? "You have no centres assigned yet. Ask a full admin to set them."
        : `That shift is at ${shift.branch || "no centre"}, which isn’t one of yours.`,
    };
  }

  const tap = roundClockIn(clean(clockInIso));
  if (!tap) return { error: "That clock-in time could not be read." };
  if (new Date(tap) > new Date(now)) return { error: "That clock-in time is in the future." };

  const window = payableWindow(toShift(shift), tap);
  if (!window) {
    return { error: "That time is after the shift ended, which would pay nothing. Cancel the shift instead." };
  }

  db.prepare(
    `UPDATE work_sessions
        SET clock_in_at = ?, started_at = ?, ended_at = ?,
            adjusted_by = ?, adjusted_at = ?, adjust_reason = ?, updated_at = ?
      WHERE id = ?`
  ).run(tap, window.startsAt, window.endsAt, admin.userId, now, why, now, row.id);

  // The reason belongs on the SHIFT as well, because that is the column the
  // monthly export prints — it is how the reason reaches whoever is reading the
  // payroll sheet rather than staying buried in the session row.
  const existing = clean(shift.note);
  const stamped = `${sgDate(now)}: ${why}`;
  db.prepare("UPDATE shifts SET note = ?, updated_at = ? WHERE id = ?")
    .run(existing ? `${existing}\n${stamped}` : stamped, now, shift.id);

  revalidatePath("/hours");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  return { ok: true, minutes: window.minutes };
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

/**
 * Add a session directly, without a clock-in. Admin only.
 *
 * Teachers used to self-enter their own past sessions and their own OT; under
 * the roster neither is theirs to declare. OT now reaches payroll as an OT
 * SHIFT inserted by MH or an IT Head after they've approved it (see
 * lib/actions/shifts.js#createShift), which keeps one creation path, one
 * uniqueness guard and one audit trail. This remains for genuine one-offs —
 * closing an unscheduled session, or correcting something after the fact.
 */
export async function addPastSession(data) {
  const session = await requireFullAdmin();
  const db = getDb();

  const times = buildTimes(data);
  if (times.error) return { error: times.error };

  const category = normalizeCategory(data.category);
  const otReason = normalizeReason(category, data.otReason);
  const branch = resolveBranch(data.branch, session.primaryLocation);
  const geo = await geoColumns(data.geo);
  const now = new Date().toISOString();

  // An admin enters these on someone else's behalf; default to themselves only
  // if no teacher was named.
  const teacherId = clean(data.teacherId) || session.userId;
  const exists = db.prepare("SELECT id FROM profiles WHERE id = ?").get(teacherId);
  if (!exists) return { error: "That teacher no longer has an account." };

  db.prepare(
    `INSERT INTO work_sessions (id, teacher_id, category, ot_reason, branch, started_at, ended_at, note, status,
                                geo_lat, geo_lng, geo_accuracy, geo_label, geo_at, source, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'admin_ot', ?, ?, ?)`
  ).run(
    randomUUID(),
    teacherId,
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
    session.userId,
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
  // Once the roster is the authority, a teacher editing their own rostered
  // session would be editing their own pay: category is freely settable here,
  // and 'ot' ($10) → 'teaching' ($25 at lead_ars) plus a longer window is a
  // straight raise. Fine while teachers self-reported; not now.
  if (!isAdmin && row.shift_id) {
    return { error: "This is a rostered shift — ask an admin if the times are wrong." };
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

  // rate_cents alone does NOT protect approved payroll: it stores $/hour, and
  // pay is rate x minutes. Changing the times (or the category, which changes
  // the rate) on an approved row therefore moves real money while the row still
  // says "approved", with no trace. Anything that changes the amount sends the
  // session back for re-approval, which re-snapshots the rate as well.
  const changesPay =
    times.startedAt !== row.started_at || times.endedAt !== row.ended_at || category !== row.category;
  const reset = changesPay && row.status === "approved"
    ? ", status = 'pending', rate_cents = NULL, ph_multiplier = NULL, reviewed_at = NULL, reviewer_id = NULL"
    : "";

  db.prepare(
    `UPDATE work_sessions
     SET category = ?, ot_reason = ?, branch = ?, started_at = ?, ended_at = ?, note = ?${geoSql}${reset}, updated_at = ?
     WHERE id = ?`
  ).run(category, otReason, branch, times.startedAt, times.endedAt, clean(data.note) || null, ...geoArgs, now, row.id);

  revalidatePath("/hours");
  revalidatePath("/admin");
  return { ok: true, reapproval: !!reset };
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
  const session = await requireFullAdmin();
  const db = getDb();
  const row = db.prepare("SELECT * FROM work_sessions WHERE id = ?").get(clean(id));
  if (!row) return { error: "Session not found." };
  if (!row.ended_at) return { error: "This session is still running — it can’t be approved yet." };

  const now = new Date().toISOString();
  // A rostered session carries a FUTURE ended_at from the moment it is created,
  // so "has an end time" no longer means "has happened". Without this, an admin
  // could approve and pay tomorrow's class today.
  if (new Date(row.ended_at) > new Date(now)) {
    return { error: "This shift hasn’t finished yet — it can’t be approved until it has." };
  }

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

  // Snapshot the public-holiday multiplier alongside the rate, for the same
  // reason: changing PH_MULTIPLIER later must never rewrite what was paid.
  const phMultiplier = row.ph_name ? PH_MULTIPLIER : null;

  db.prepare(
    "UPDATE work_sessions SET status = 'approved', rate_cents = ?, ph_multiplier = ?, reviewer_id = ?, reviewer_note = NULL, reviewed_at = ?, updated_at = ? WHERE id = ?"
  ).run(Math.round(rate * 100), phMultiplier, session.userId, now, now, row.id);

  revalidatePath("/admin");
  revalidatePath("/hours");
  return { ok: true };
}

export async function rejectSession(id, note) {
  const session = await requireFullAdmin();
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
  await requireFullAdmin();
  const db = getDb();

  const now = new Date().toISOString();

  // Pending queue: only work that has actually FINISHED (see PAYABLE_SQL) — a
  // rostered session exists from the moment someone clocks in and would
  // otherwise queue up tomorrow's classes for approval today.
  const pending = db
    .prepare(`${ADMIN_SELECT} WHERE ${PAYABLE_SQL} AND w.status = 'pending' ORDER BY w.started_at ASC`)
    .all({ now })
    .map((r) => toSession(r, now));

  // Monthly summary: every finished, non-rejected session that falls in `month`.
  const rows = db
    .prepare(`${ADMIN_SELECT} WHERE ${PAYABLE_SQL} AND w.status != 'rejected' ORDER BY w.started_at ASC`)
    .all({ now })
    .map((r) => toSession(r, now))
    // A pending public-holiday session hasn't snapshotted a multiplier yet, so
    // its estimate uses today's constant.
    .map((s) => ({ ...s, phEstimateMultiplier: s.phName ? PH_MULTIPLIER : null }));

  const summary = summariseSessions(rows, month);
  return { month, pending, summary };
}

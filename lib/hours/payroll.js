// Monthly payroll aggregation.
//
// Extracted from lib/actions/hours.js#hoursAdminData so it can be tested
// directly: this is the branch that decides what each teacher is owed, and it
// carries the two snapshot rules that keep past payroll stable.
//
//   1. An APPROVED session pays its snapshotted rate_cents (and ph_multiplier),
//      never the teacher's current tier — so a promotion, or a change to
//      PH_MULTIPLIER, never rewrites a month that has already been signed off.
//   2. A PENDING session is only ever an ESTIMATE at today's rate.
//
// Pure — no DB, no server imports.

import { rateFor, sessionPayCents, sgMonth } from "./rates.js";

/**
 * Total a month per teacher.
 *
 * `sessions` should already be filtered to finished work (see PAYABLE_SQL) and
 * shaped by toSession. Rejected sessions are ignored.
 */
export function summariseSessions(sessions, month) {
  const byTeacher = new Map();

  for (const s of sessions || []) {
    if (s.status === "rejected") continue;
    if (sgMonth(s.startedAt) !== month) continue;

    let t = byTeacher.get(s.teacherId);
    if (!t) {
      t = {
        teacherId: s.teacherId,
        teacherName: s.teacherName,
        payTier: s.payTier || null,
        teachingMinutes: 0,
        otMinutes: 0,
        phMinutes: 0,
        approvedCents: 0,
        pendingCents: 0,
        pendingCount: 0,
      };
      byTeacher.set(s.teacherId, t);
    }

    if (s.category === "ot") t.otMinutes += s.minutes;
    else t.teachingMinutes += s.minutes;
    if (s.phName) t.phMinutes += s.minutes;

    if (s.status === "approved") {
      // Snapshotted rate; fall back to the current one only if it is somehow
      // missing, so a bad row shows a figure rather than silently paying zero.
      const rate = s.rateCents != null ? s.rateCents / 100 : rateFor(s.category, s.payTier);
      t.approvedCents += sessionPayCents(s.minutes, rate, s.phMultiplier);
    } else {
      // Estimate: current rate, and the CURRENT public-holiday multiplier,
      // because nothing has been snapshotted yet.
      t.pendingCents += sessionPayCents(s.minutes, rateFor(s.category, s.payTier), s.phEstimateMultiplier);
      t.pendingCount += 1;
    }
  }

  return [...byTeacher.values()].sort((a, b) => (a.teacherName || "").localeCompare(b.teacherName || ""));
}

/** Column totals for the payroll table's footer. */
export function summaryTotals(summary) {
  return (summary || []).reduce(
    (a, t) => ({
      teachingMinutes: a.teachingMinutes + t.teachingMinutes,
      otMinutes: a.otMinutes + t.otMinutes,
      phMinutes: a.phMinutes + t.phMinutes,
      approvedCents: a.approvedCents + t.approvedCents,
      pendingCents: a.pendingCents + t.pendingCents,
    }),
    { teachingMinutes: 0, otMinutes: 0, phMinutes: 0, approvedCents: 0, pendingCents: 0 }
  );
}

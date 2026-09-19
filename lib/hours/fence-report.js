// Reading the geofence's recorded verdicts, so switching it on is a decision
// and not a gamble.
//
// The fence ships OFF, but every clock-in still computes its verdict and writes
// it to work_sessions.geo_fence / geo_fence_m. That was the whole point of
// shipping it off: the distances from real taps, on real phones, on the real
// upper floors of real office blocks, can be read back BEFORE anybody throws a
// switch that can stop people starting work.
//
// This module turns those rows into the one answer somebody needs — "if the
// fence had been on, how many people would have been turned away, and who?" —
// and nothing else. Pure: no DB, no server imports, so the rule can be tested
// without a database and the screen and the action cannot disagree about it.

/**
 * The verdicts that would actually REFUSE a clock-in.
 *
 * Deliberately not "everything that isn't inside". `no_fix` is recorded and
 * never refused — lib/actions/hours.js geofenceRefusal() returns null for it —
 * because a phone that cannot get a fix is a hardware problem, not a teacher
 * standing in the wrong place, and every centre is on an upper floor where GPS
 * is at its worst. Counting no_fix as a block here would overstate the risk of
 * turning the fence on and talk somebody out of a switch that is fine.
 *
 * Keep this in step with geofenceRefusal(). If that function starts refusing a
 * reason, it belongs in this set, and test/fence-report.test.mjs pins the pair.
 */
export const BLOCKING_REASONS = ["too_far", "no_coords", "unknown_branch"];

/** Would a recorded verdict have refused the clock-in, had the fence been on? */
export function wouldBlock(reason) {
  return BLOCKING_REASONS.includes(String(reason || ""));
}

/** How a distance should read to a person. Metres up close, km beyond one. */
export function metresLabel(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

const REASON_LABELS = {
  inside: "At the centre",
  too_far: "Too far away",
  no_fix: "Phone gave no location",
  no_coords: "Centre not set up",
  unknown_branch: "Location not recognised",
  unfenced: "Not checked (HQ, Outside LQK, Online)",
};

export function reasonLabel(reason) {
  return REASON_LABELS[reason] || reason || "Unknown";
}

/**
 * Summarise recorded verdicts.
 *
 * `rows` are the raw shapes the action reads: { reason, metres, branch, teacher,
 * at }. Rows with no recorded verdict are dropped rather than counted as
 * anything — a session from before the fence existed is not evidence either
 * way, and quietly bucketing it as "inside" would make the report lie in the
 * reassuring direction.
 */
export function summariseVerdicts(rows) {
  const seen = (rows || []).filter((r) => r && r.reason);

  const byReason = {};
  const centres = new Map();
  let blocked = 0;
  let from = null;
  let to = null;

  for (const r of seen) {
    byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    if (r.at) {
      if (!from || r.at < from) from = r.at;
      if (!to || r.at > to) to = r.at;
    }

    // Only FENCED taps belong in the per-centre table. An "Online" shift has
    // no place to be near, so listing it with 0 blocked would pad the table
    // with rows that can never say anything.
    if (r.reason === "unfenced") continue;

    const key = r.branch || "No location";
    if (!centres.has(key)) {
      centres.set(key, { branch: key, taps: 0, inside: 0, blocked: 0, noFix: 0, maxInsideM: null, worstM: null });
    }
    const c = centres.get(key);
    c.taps += 1;
    if (r.reason === "inside") {
      c.inside += 1;
      if (Number.isFinite(r.metres) && (c.maxInsideM == null || r.metres > c.maxInsideM)) {
        c.maxInsideM = r.metres;
      }
    }
    if (r.reason === "no_fix") c.noFix += 1;
    if (wouldBlock(r.reason)) {
      c.blocked += 1;
      blocked += 1;
      if (Number.isFinite(r.metres) && (c.worstM == null || r.metres > c.worstM)) c.worstM = r.metres;
    }
  }

  const fenced = seen.filter((r) => r.reason !== "unfenced").length;

  return {
    total: seen.length,
    fenced,
    byReason,
    blocked,
    noFix: byReason.no_fix || 0,
    window: { from, to },
    // Worst first: the rows worth reading are the ones that would have been
    // refused, and a centre with one refusal in eighty taps is a different
    // conversation from one with eighty in eighty.
    perCentre: [...centres.values()].sort((a, b) => b.blocked - a.blocked || b.taps - a.taps),
    // The ones to actually look at, in full, named.
    blocking: seen
      .filter((r) => wouldBlock(r.reason))
      .sort((a, b) => (b.metres ?? 0) - (a.metres ?? 0)),
  };
}

/**
 * Whether the fence can be switched on, and the one sentence that says why.
 *
 * Four states, kept apart because they need different actions from the person
 * reading them:
 *
 *   blocked   — a centre has no coordinates. The switch is refused by
 *               setGeofenceEnabled() anyway; this explains it before they try.
 *   no_data   — resolved, but nothing has clocked in yet. Turning it on is
 *               allowed and untested, and saying so is more honest than a
 *               green tick over an empty table.
 *   review    — some recorded taps would have been refused. Named, so they can
 *               be looked at rather than averaged away.
 *   ready     — every recorded tap would have gone through.
 */
export function readinessOf(summary, unresolvedLabels = []) {
  if (unresolvedLabels.length) {
    return {
      state: "blocked",
      canEnable: false,
      message:
        `${unresolvedLabels.length} centre${unresolvedLabels.length === 1 ? "" : "s"} ` +
        `still ${unresolvedLabels.length === 1 ? "has" : "have"} no coordinates ` +
        `(${unresolvedLabels.join(", ")}). Resolve them first — with the fence on, ` +
        `every clock-in there would be refused.`,
    };
  }
  if (!summary || !summary.fenced) {
    return {
      state: "no_data",
      canEnable: true,
      message:
        "Every centre has coordinates, but no clock-in has been recorded at one yet, " +
        "so there is nothing to check the fence against. It will work; nobody has proved it here.",
    };
  }
  if (summary.blocked > 0) {
    const pct = Math.round((summary.blocked / summary.fenced) * 100);
    return {
      state: "review",
      canEnable: true,
      message:
        `${summary.blocked} of ${summary.fenced} recorded clock-ins (${pct}%) would have been refused. ` +
        `Read them below before switching the fence on — each one is somebody who would not have started their shift.`,
    };
  }
  return {
    state: "ready",
    canEnable: true,
    message:
      `All ${summary.fenced} recorded clock-ins at a centre would have gone through. ` +
      (summary.noFix
        ? `${summary.noFix} of them had no location from the phone — those are never refused, so the fence simply would not have checked them.`
        : "Nothing recorded would have been turned away."),
  };
}

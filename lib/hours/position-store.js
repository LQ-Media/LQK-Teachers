import "server-only";
import { getDb } from "@/lib/db";
import { SHIFT_POSITIONS, POSITION_GROUPS } from "./positions.js";
import { OT_ROLE_BY_KEY } from "./rates.js";
import { ROLE_COLOURS } from "./calendar.js";

// Reading and writing the editable position list.
//
// lib/hours/positions.js stays as the SEED and the FALLBACK, and keeps the pure
// helpers the form and the action share. This module is the live list.
//
// Why a fallback at all: the New shift form with an empty Position dropdown is
// unusable, and a position the action does not recognise is refused — so an
// empty table would mean no shifts could be created. The code list is the floor
// under that, and the one case it covers (a database somehow seeded with
// nothing) is exactly the one nobody would debug at 7am.

/** The whole list, archived rows included, in display order. */
export function allPositions() {
  const rows = getDb()
    .prepare(
      `SELECT name, category, ot_role, group_name, colour, sort_order, archived_at
       FROM shift_positions ORDER BY sort_order ASC, name ASC`
    )
    .all()
    .map((r) => ({
      key: r.name,
      category: r.category,
      otRole: r.ot_role || null,
      group: r.group_name,
      colour: r.colour || null,
      sortOrder: r.sort_order,
      archivedAt: r.archived_at || null,
    }));

  if (rows.length) return rows;

  // The floor. Shaped identically so no caller has to know which it got.
  return SHIFT_POSITIONS.map((p, i) => ({
    key: p.key,
    category: p.category,
    otRole: p.otRole,
    group: p.group,
    colour: null,
    sortOrder: i,
    archivedAt: null,
  }));
}

/** The ones a new shift may be created with — archived rows excluded. */
export function livePositions() {
  return allPositions().filter((p) => !p.archivedAt);
}

/**
 * What a position means, from the live list.
 *
 * Returns null for anything not on it, exactly as the pure positionMeaning()
 * does, and for the same reason: the caller must refuse rather than fall back
 * to teaching. An unrecognised position quietly becoming a paid teaching shift
 * would be a guess about money.
 *
 * ARCHIVED POSITIONS ARE ACCEPTED here, unlike in livePositions(). Editing a
 * shift that already carries an archived position must not be refused because
 * somebody tidied the list afterwards — archiving hides a position from the
 * picker, it does not invalidate the shifts already worked in it.
 */
export function positionMeaningLive(key) {
  const wanted = String(key ?? "").trim();
  if (!wanted) return null;
  const hit = allPositions().find((p) => p.key === wanted);
  return hit || null;
}

/** The groups present, in the picker's order, so an empty group draws nothing. */
export function groupsPresent(positions) {
  const seen = new Set((positions || []).map((p) => p.group));
  const known = POSITION_GROUPS.filter((g) => seen.has(g));
  // A group somebody typed that is not one of the two known ones still has to
  // appear, or its positions would vanish from the picker entirely.
  const extra = [...seen].filter((g) => !POSITION_GROUPS.includes(g)).sort();
  return [...known, ...extra];
}

// ---- Validation --------------------------------------------------------
//
// Exported so the action and the tests read the same rules. Returns an error
// STRING or null, in the same shape as the rest of lib/actions.

/** The colours a position may be given — the calendar's own palette. */
export const COLOUR_KEYS = Object.keys(ROLE_COLOURS).filter((k) => k !== "cancelled");

export const MAX_NAME = 40;

/**
 * Check a position about to be saved.
 *
 * `existing` is the current list; `originalName` is set when editing, so a
 * position is not reported as clashing with itself.
 */
export function validatePosition({ name, category, otRole, group }, existing, originalName = null) {
  const clean = String(name ?? "").trim();
  if (!clean) return "Give the position a name.";
  if (clean.length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters.`;

  // The name is the value stored on every shift, so a comma or a pipe in it
  // would land in CSV exports and GROUP_CONCAT lists that split on those.
  if (/[,|;\t\n\r]/.test(clean)) return "A position name can’t contain a comma, semicolon or pipe.";

  if (category !== "teaching" && category !== "ot") return "Choose whether it logs as teaching or OT.";

  if (category === "ot" && otRole && !OT_ROLE_BY_KEY[otRole]) {
    return "That isn’t a team the payroll report knows about.";
  }
  // A teaching position with an OT team would be contradictory, and the
  // payroll report reads ot_role only for OT shifts — so it would be a stored
  // value nothing ever looks at, waiting to confuse somebody.
  if (category === "teaching" && otRole) return "A teaching position can’t belong to an OT team.";

  if (!String(group ?? "").trim()) return "Choose a group.";

  // Case-insensitive, because "Lead teacher" and "Lead Teacher" as two rows is
  // two colours for one job and an admin picking whichever appears first.
  const folded = clean.toLowerCase();
  const clash = (existing || []).find(
    (p) => p.key.toLowerCase() === folded && p.key !== originalName
  );
  if (clash) return `There is already a position called “${clash.key}”.`;

  return null;
}

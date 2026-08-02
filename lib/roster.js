/**
 * Joining a login account (profiles) to its roster row (students).
 *
 * The two tables are deliberately separate — the roster is the list of staff
 * whose hifz is tracked, and it predates self-registration because it was
 * imported from the Sheet. They meet only at students.profile_id, and until
 * that column is set a person's own lessons cannot be credited to their
 * account (see the note on students.profile_id in lib/db.js).
 *
 * Registration now calls attachToRoster so a new account never lands in that
 * unlinked limbo.
 */

import { TRACKER_CLASSES } from "./db.js";

/**
 * Roster rows are grouped by class, which mirrors the branch names in upper
 * case. HQ is the exception: it is not a teaching class, so head-office staff
 * belong to MANAGEMENT TEAM.
 */
export function classForBranch(branch) {
  const upper = String(branch || "").trim().toUpperCase();
  if (TRACKER_CLASSES.includes(upper)) return upper;
  return "MANAGEMENT TEAM";
}

/**
 * Compare names the way link-roster-accounts.mjs does: the Sheet's Teachers and
 * Students tabs spell the same person differently, so honorifics and filial
 * markers are dropped before matching. Keep the two in step.
 */
export function normaliseName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(ustaz|ustazah|ust|mr|mrs|ms|md|muhd)\b/g, " ")
    .replace(/\b(bin|binte|binti|bt|s\/o|d\/o)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Put a newly created account on the roster.
 *
 * Claims the person's existing roster row when the name matches exactly one
 * unclaimed entry — that keeps the juz and lesson history they already have.
 * Otherwise adds a new row, so someone who was never on the Sheet still shows
 * up. An ambiguous name (two unclaimed rows normalise the same) is left for an
 * admin rather than guessed at, since a wrong link credits one person's
 * memorisation to another.
 *
 * Returns { action: "linked" | "created" | "ambiguous", studentId }.
 */
export function attachToRoster(db, { profileId, fullName, branch, position }) {
  // A profile may only claim one roster row (linkRosterToAccount enforces the
  // same rule), so never touch a profile that is somehow already on the list.
  const already = db.prepare("SELECT id FROM students WHERE profile_id = ?").get(profileId);
  if (already) return { action: "linked", studentId: already.id };

  const wanted = normaliseName(fullName);
  let matches = [];
  if (wanted) {
    matches = db
      .prepare("SELECT id, name FROM students WHERE profile_id IS NULL")
      .all()
      .filter((s) => normaliseName(s.name) === wanted);
  }

  if (matches.length === 1) {
    db.prepare("UPDATE students SET profile_id = ? WHERE id = ?").run(profileId, matches[0].id);
    return { action: "linked", studentId: matches[0].id };
  }
  if (matches.length > 1) return { action: "ambiguous", studentId: null };

  // students.id keeps the original Sheet ids, so new rows continue the sequence
  // rather than relying on rowid reuse.
  const { max } = db.prepare("SELECT MAX(id) AS max FROM students").get();
  const id = (max || 0) + 1;
  db.prepare(
    "INSERT INTO students (id, name, class, juz, position, photo, profile_id, created_at) VALUES (?, ?, ?, 1, ?, '', ?, ?)"
  ).run(id, fullName, classForBranch(branch), String(position || ""), profileId, new Date().toISOString());

  return { action: "created", studentId: id };
}

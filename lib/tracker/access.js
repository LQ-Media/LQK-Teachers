import "server-only";
import { getDb, TRACKER_CLASSES } from "@/lib/db";

/**
 * Which tracker classes a session may see.
 * - admin / reviewer: all classes.
 * - teacher: only classes matching their branch(es) — primary_location plus any
 *   teacher_locations — compared case-insensitively (locations are Title Case,
 *   tracker classes are UPPERCASE).
 */
export function allowedClassesFor(session) {
  if (session.role === "admin" || session.role === "reviewer") {
    return TRACKER_CLASSES.slice();
  }
  const db = getDb();
  const locs = new Set();
  if (session.primaryLocation) locs.add(session.primaryLocation.toUpperCase());
  for (const row of db.prepare("SELECT location FROM teacher_locations WHERE teacher_id = ?").all(session.userId)) {
    if (row.location) locs.add(row.location.toUpperCase());
  }
  return TRACKER_CLASSES.filter((c) => locs.has(c.toUpperCase()));
}

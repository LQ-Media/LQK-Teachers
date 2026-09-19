"use server";

import { revalidatePath } from "next/cache";
import { requireFullAdmin, requireRole } from "@/lib/dal";
import { getDb } from "@/lib/db";
import {
  allPositions,
  livePositions,
  validatePosition,
  COLOUR_KEYS,
  MAX_NAME,
} from "@/lib/hours/position-store";

// Editing the position list, from Shift Roster → Positions.
//
// Karim, 17 Sep: "i need the positions page or it to be edittable for me if i
// need to edit or add."
//
// READING is open to any admin — a centre IT Head rosters, and needs to know
// which position pays as teaching. WRITING is full admin only: the list decides
// how every shift is classified on the payroll report, and a rename rewrites
// every shift that carries it.

function clean(v) {
  return String(v ?? "").trim();
}

/** The list, with how many shifts and how many people are on each. */
export async function positionList() {
  await requireRole(["admin"]);
  const db = getDb();

  // Two different counts, because they answer two different questions and
  // conflating them is how somebody archives a position that is on next week's
  // roster. `shifts` is what would be affected by a rename; `people` is whose
  // profile title happens to match, which is only ever a hint.
  const shiftCounts = new Map(
    db
      .prepare("SELECT position, COUNT(*) AS c FROM shifts WHERE position IS NOT NULL GROUP BY position")
      .all()
      .map((r) => [r.position, r.c])
  );
  const upcoming = new Map(
    db
      .prepare(
        `SELECT position, COUNT(*) AS c FROM shifts
         WHERE position IS NOT NULL AND status = 'planned' AND ends_at > ?
         GROUP BY position`
      )
      .all(new Date().toISOString())
      .map((r) => [r.position, r.c])
  );
  const peopleCounts = new Map(
    db
      .prepare("SELECT position, COUNT(*) AS c FROM profiles WHERE position IS NOT NULL AND position != '' GROUP BY position")
      .all()
      .map((r) => [String(r.position).trim().toUpperCase(), r.c])
  );

  const rows = allPositions().map((p) => ({
    ...p,
    shifts: shiftCounts.get(p.key) || 0,
    upcoming: upcoming.get(p.key) || 0,
    people: peopleCounts.get(p.key.toUpperCase()) || 0,
  }));

  return { positions: rows, colours: COLOUR_KEYS, maxName: MAX_NAME };
}

/**
 * Add a position, or rename and re-classify an existing one.
 *
 * A RENAME REWRITES shifts.position IN THE SAME TRANSACTION. The name is the
 * value stored on every shift, so the two must move together or the shifts are
 * orphaned onto a position that no longer exists — which the New shift form
 * would then refuse to edit, and the calendar would colour as "teaching"
 * whatever it really was.
 */
export async function savePosition(data) {
  const session = await requireFullAdmin();
  const db = getDb();

  const originalName = clean(data.originalName) || null;
  const name = clean(data.name);
  const category = data.category === "ot" ? "ot" : data.category === "teaching" ? "teaching" : null;
  const otRole = category === "ot" ? clean(data.otRole) || null : null;
  const group = clean(data.group) || (category === "ot" ? "Non-teaching" : "Teaching");
  const colour = COLOUR_KEYS.includes(clean(data.colour)) ? clean(data.colour) : null;

  const existing = allPositions();
  const bad = validatePosition({ name, category, otRole, group }, existing, originalName);
  if (bad) return { error: bad };

  const current = originalName ? existing.find((p) => p.key === originalName) : null;
  if (originalName && !current) return { error: "That position no longer exists — reload the page." };

  const now = new Date().toISOString();
  let renamedShifts = 0;

  db.exec("BEGIN");
  try {
    if (!current) {
      const nextOrder = existing.length ? Math.max(...existing.map((p) => p.sortOrder)) + 1 : 0;
      db.prepare(
        `INSERT INTO shift_positions (name, category, ot_role, group_name, colour, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(name, category, otRole, group, colour, nextOrder, now, now);
    } else {
      db.prepare(
        `UPDATE shift_positions
         SET name = ?, category = ?, ot_role = ?, group_name = ?, colour = ?, updated_at = ?
         WHERE name = ?`
      ).run(name, category, otRole, group, colour, now, originalName);

      if (name !== originalName) {
        renamedShifts = db
          .prepare("UPDATE shifts SET position = ?, updated_at = ? WHERE position = ?")
          .run(name, now, originalName).changes;
      }

      // The shift's CATEGORY and OT TEAM are deliberately NOT rewritten on the
      // shifts already created. Those are stamped at creation and are what the
      // payroll report reads; re-classifying a position must not silently
      // re-price work that has been done and approved. New shifts pick up the
      // new meaning; the old ones keep what they were worked as.
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    if (String(err?.message || "").includes("UNIQUE")) {
      return { error: `There is already a position called “${name}”.` };
    }
    throw err;
  }

  revalidatePath("/admin");
  return {
    ok: true,
    name,
    created: !current,
    renamedFrom: current && name !== originalName ? originalName : null,
    renamedShifts,
    // Said back so the screen can warn rather than hide it.
    reclassified: !!current && (current.category !== category || (current.otRole || null) !== otRole),
    by: session.fullName || null,
  };
}

/**
 * Archive a position, or bring it back.
 *
 * Archiving only hides it from the pickers. Every shift that carries it keeps
 * it, and editing one of those shifts still works — see positionMeaningLive().
 * Deleting was the other option and is not offered: a position is the
 * classification on months of worked, approved, paid shifts, and removing the
 * row would leave those shifts pointing at nothing.
 */
export async function setPositionArchived(name, archived) {
  await requireFullAdmin();
  const db = getDb();
  const key = clean(name);

  const row = db.prepare("SELECT name, archived_at FROM shift_positions WHERE name = ?").get(key);
  if (!row) return { error: "That position no longer exists — reload the page." };

  const want = !!archived;
  if (want === !!row.archived_at) return { ok: true, name: key, archived: want };

  // Refusing to archive the last live position, because a New shift form with
  // an empty Position dropdown cannot create anything at all.
  if (want && livePositions().filter((p) => p.key !== key).length === 0) {
    return { error: "That’s the last position left. Add another before archiving this one." };
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE shift_positions SET archived_at = ?, updated_at = ? WHERE name = ?").run(
    want ? now : null,
    now,
    key
  );

  // How many shifts still ahead of us carry it, so the screen can say "hidden
  // from the picker; 14 shifts still have it" rather than implying they are
  // gone.
  const stillUpcoming = db
    .prepare(
      "SELECT COUNT(*) AS c FROM shifts WHERE position = ? AND status = 'planned' AND ends_at > ?"
    )
    .get(key, now).c;

  revalidatePath("/admin");
  return { ok: true, name: key, archived: want, stillUpcoming };
}

/** Move a position up or down the picker. */
export async function movePosition(name, direction) {
  await requireFullAdmin();
  const db = getDb();
  const key = clean(name);
  const delta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  if (!delta) return { error: "Pick a direction." };

  // Ordered within the group, because the picker draws groups separately and
  // swapping across a group boundary would look like nothing happened.
  const list = allPositions();
  const me = list.find((p) => p.key === key);
  if (!me) return { error: "That position no longer exists — reload the page." };

  const peers = list.filter((p) => p.group === me.group);
  const at = peers.findIndex((p) => p.key === key);
  const swapWith = peers[at + delta];
  if (!swapWith) return { ok: true, moved: false };

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const set = db.prepare("UPDATE shift_positions SET sort_order = ?, updated_at = ? WHERE name = ?");
    set.run(swapWith.sortOrder, now, me.key);
    set.run(me.sortOrder, now, swapWith.key);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  revalidatePath("/admin");
  return { ok: true, moved: true };
}

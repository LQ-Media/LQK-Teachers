import "server-only";
import path from "node:path";
import { mkdirSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getDb, getDataDir } from "@/lib/db";
import { BY_CODE } from "@/lib/countries";
import { defaultPrayers, sanitizePrayers } from "./catalog";

// Custom azan uploads live on the persistent volume next to avatars.
export const AZAN_DIR = path.join(getDataDir(), "uploads", "azan");
export const MAX_AZAN_BYTES = 8 * 1024 * 1024; // 8 MB
export const AZAN_EXT_BY_TYPE = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};
export const AZAN_CONTENT_TYPE = { mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" };

export function customSoundPath(id, ext) {
  return path.join(AZAN_DIR, `${id}.${ext}`);
}

export function listCustomSounds(teacherId) {
  return getDb()
    .prepare("SELECT id, label, ext, created_at FROM azan_sounds WHERE teacher_id = ? ORDER BY created_at")
    .all(teacherId);
}

export function getCustomSound(id) {
  return getDb().prepare("SELECT id, teacher_id, label, ext FROM azan_sounds WHERE id = ?").get(id);
}

export function addCustomSound(teacherId, label, ext, bytes) {
  mkdirSync(AZAN_DIR, { recursive: true });
  const id = randomUUID();
  writeFileSync(customSoundPath(id, ext), bytes);
  getDb()
    .prepare("INSERT INTO azan_sounds (id, teacher_id, label, ext, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, teacherId, label, ext, new Date().toISOString());
  return { id, label, ext };
}

export function deleteCustomSound(teacherId, id) {
  const row = getCustomSound(id);
  if (!row || row.teacher_id !== teacherId) return false;
  getDb().prepare("DELETE FROM azan_sounds WHERE id = ?").run(id);
  const file = customSoundPath(row.id, row.ext);
  if (existsSync(file)) unlinkSync(file);
  return true;
}

// ---- Settings -----------------------------------------------------------

export function getAzanSettings(teacherId) {
  const row = getDb()
    .prepare("SELECT muted, country, tz, prayers FROM azan_settings WHERE teacher_id = ?")
    .get(teacherId);
  if (!row) return { muted: false, country: "auto", tz: null, prayers: defaultPrayers() };
  let prayers;
  try {
    prayers = sanitizePrayers(JSON.parse(row.prayers), new Set(listCustomSounds(teacherId).map((s) => s.id)));
  } catch {
    prayers = defaultPrayers();
  }
  return { muted: !!row.muted, country: row.country || "auto", tz: row.tz || null, prayers };
}

/** Partial update: only the provided keys change; the rest are preserved. */
export function saveAzanSettings(teacherId, patch) {
  const current = getAzanSettings(teacherId);
  const customIds = new Set(listCustomSounds(teacherId).map((s) => s.id));

  const muted = typeof patch.muted === "boolean" ? patch.muted : current.muted;
  const country =
    typeof patch.country === "string" && (patch.country === "auto" || BY_CODE[patch.country])
      ? patch.country
      : current.country;
  const tz = typeof patch.tz === "string" && patch.tz.length <= 64 ? patch.tz : current.tz;
  const prayers = patch.prayers ? sanitizePrayers(patch.prayers, customIds) : current.prayers;

  getDb()
    .prepare(
      `INSERT INTO azan_settings (teacher_id, muted, country, tz, prayers, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(teacher_id) DO UPDATE SET
         muted = excluded.muted, country = excluded.country, tz = excluded.tz,
         prayers = excluded.prayers, updated_at = excluded.updated_at`
    )
    .run(teacherId, muted ? 1 : 0, country, tz, JSON.stringify(prayers), new Date().toISOString());

  return { muted, country, tz, prayers };
}

// ---- Push subscriptions -------------------------------------------------

export function saveSubscription(teacherId, subscription) {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) return false;
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (id, teacher_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         teacher_id = excluded.teacher_id, p256dh = excluded.p256dh, auth = excluded.auth`
    )
    .run(randomUUID(), teacherId, endpoint, keys.p256dh, keys.auth, new Date().toISOString());
  return true;
}

export function deleteSubscription(teacherId, endpoint) {
  getDb().prepare("DELETE FROM push_subscriptions WHERE teacher_id = ? AND endpoint = ?").run(teacherId, endpoint);
}

export function deleteSubscriptionByEndpoint(endpoint) {
  getDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function countSubscriptions(teacherId) {
  return getDb().prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE teacher_id = ?").get(teacherId).n;
}

/** Users who have at least one push subscription, with their azan settings. */
export function usersWithSubscriptions() {
  return getDb()
    .prepare(
      `SELECT s.teacher_id, s.muted, s.country, s.tz, s.prayers
       FROM azan_settings s
       WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.teacher_id = s.teacher_id)`
    )
    .all();
}

export function subscriptionsFor(teacherId) {
  return getDb()
    .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE teacher_id = ?")
    .all(teacherId);
}

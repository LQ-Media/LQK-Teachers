import "server-only";
import path from "node:path";
import { getDataDir } from "@/lib/db";

export const AVATAR_DIR = path.join(getDataDir(), "uploads", "avatars");
export const MAX_AVATAR_BYTES = 3 * 1024 * 1024; // 3 MB
export const AVATAR_EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const AVATAR_CONTENT_TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

// A stored photo is either an external URL (from the Sheet import) or a local
// upload filename we generated. Only local filenames are served from disk.
export function isLocalAvatar(photo) {
  return !!photo && /^[a-f0-9-]+\.(jpg|png|webp)$/i.test(photo);
}

export function isExternalAvatar(photo) {
  return !!photo && /^https?:\/\//i.test(photo);
}

// The <img> src for a profile photo, or null when there is none. Local uploads
// go through the /api/avatar route (session-gated); the `?v=` busts the browser
// cache whenever the stored filename changes.
export function avatarSrc(id, photo) {
  if (isExternalAvatar(photo)) return photo;
  if (isLocalAvatar(photo)) return `/api/avatar/${id}?v=${encodeURIComponent(photo)}`;
  return null;
}

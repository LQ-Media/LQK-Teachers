import "server-only";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { getDataDir } from "@/lib/db";

// Event logos and backgrounds live on the persistent volume beside the avatars
// and cert scans — never in the repo, and never in public/, because they are
// uploaded at runtime and must survive a redeploy.
export const EVENT_ASSET_DIR = path.join(getDataDir(), "uploads", "events");

// A background is a full-bleed photo, so it gets more headroom than a logo.
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_BACKGROUND_BYTES = 6 * 1024 * 1024; // 6 MB

export const ASSET_EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  // SVG is accepted for logos only (see kindLimits) — it is a script-capable
  // format, so it is served with a restrictive Content-Type and CSP header.
  "image/svg+xml": "svg",
};

export const ASSET_CONTENT_TYPE = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export function kindLimits(kind) {
  return kind === "background"
    ? { maxBytes: MAX_BACKGROUND_BYTES, allowSvg: false }
    : { maxBytes: MAX_LOGO_BYTES, allowSvg: true };
}

// Only filenames this module generated are ever read back off disk.
export function isEventAssetFile(name) {
  return !!name && /^[a-f0-9-]+\.(jpg|png|webp|svg)$/i.test(name);
}

export function eventAssetPath(name) {
  if (!isEventAssetFile(name)) return null;
  return path.join(EVENT_ASSET_DIR, name);
}

// The URL an invite page or email uses to fetch the asset. Kept absolute-path
// (not absolute-URL) here; the email renderer prefixes the public origin.
export function eventAssetUrl(name) {
  return isEventAssetFile(name) ? `/api/events/asset/${name}` : null;
}

export function saveEventAsset(bytes, ext) {
  mkdirSync(EVENT_ASSET_DIR, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  writeFileSync(path.join(EVENT_ASSET_DIR, name), bytes);
  return name;
}

// Best-effort cleanup when an asset is replaced or its event is deleted. A
// failure here must never break the surrounding action — a stray file on the
// volume is a much smaller problem than a 500 on save.
export function deleteEventAsset(name) {
  try {
    const p = eventAssetPath(name);
    if (p && existsSync(p)) unlinkSync(p);
  } catch {
    // ignore
  }
}

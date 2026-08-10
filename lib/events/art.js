import "server-only";
import path from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getDataDir } from "@/lib/db";

/* Generated invitation background art, stored on the persistent volume next to
   the azan uploads and avatars.

   Files rather than a base64 column: this image is a *background*, so it is
   re-sent with every invitation every guest opens. Inlined as a data: URI it
   would add ~400 KB of uncacheable base64 to each page load; as a file it is
   one request that the browser caches for a year. The URL is same-origin, which
   is also the only shape sanitizeTheme accepts.

   Ids are UUIDs and the served route is public — the art is decorative and
   guests have no session, so there is nothing here to gate. Nothing about an
   event, a guest or an RSVP can be recovered from it. */

export const ART_DIR = path.join(getDataDir(), "uploads", "event-art");

const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function artPath(id, ext) {
  return path.join(ART_DIR, `${id}.${ext}`);
}

/* The public URL. Must start with "/" — sanitizeTheme rejects anything else,
   which is what stops a generated theme pointing a guest's browser off-site. */
export function artUrl(id, ext) {
  return `/api/events/art/${id}.${ext}`;
}

export function parseArtName(name) {
  const match = /^([0-9a-f-]{36})\.(png|jpg|webp)$/i.exec(String(name || ""));
  return match ? { id: match[1], ext: match[2].toLowerCase() } : null;
}

/* Gemini returns a ~1.4 MB PNG. That is unacceptable as the background of a
   page 200 guests open on mobile data, and it is pure waste: this image is
   painted at 18% opacity behind text, so it has no detail worth keeping.
   Recompressing to WebP takes it to well under 100 KB.

   sharp comes in with Next's image optimiser rather than our own package.json,
   so it is loaded lazily and the raw bytes are kept if it is ever missing —
   a heavy background is a bad invitation, but a failed save is no invitation. */
async function compress(bytes) {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(bytes)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    return { bytes: out, mime: "image/webp" };
  } catch {
    return null;
  }
}

export async function saveArt(bytes, mime) {
  const compressed = await compress(bytes);
  const final = compressed || { bytes, mime };

  const ext = EXT_BY_MIME[final.mime] || "png";
  mkdirSync(ART_DIR, { recursive: true });
  const id = randomUUID();
  writeFileSync(artPath(id, ext), final.bytes);
  return { id, ext, url: artUrl(id, ext), bytes: final.bytes.length };
}

export function readArt(id, ext) {
  const file = artPath(id, ext);
  // Guard against a crafted id escaping the directory even though parseArtName
  // already constrains the shape — two cheap checks, one irreversible mistake.
  if (!file.startsWith(ART_DIR + path.sep) || !existsSync(file)) return null;
  return readFileSync(file);
}

/* Sweeps art no longer referenced by any event.

   The studio generates freely — Karim will try a dozen backgrounds before he
   likes one — and only the approved and draft themes matter. Called after an
   approve, when the abandoned candidates are known to be dead. */
export function pruneUnusedArt(referencedUrls) {
  if (!existsSync(ART_DIR)) return 0;
  const keep = new Set(
    referencedUrls.filter(Boolean).map((url) => String(url).split("/").pop())
  );
  let removed = 0;
  for (const name of readdirSync(ART_DIR)) {
    if (keep.has(name) || !parseArtName(name)) continue;
    try {
      unlinkSync(path.join(ART_DIR, name));
      removed += 1;
    } catch {}
  }
  return removed;
}

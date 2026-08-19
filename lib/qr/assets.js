import "server-only";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "@/lib/db";
import { ASSET_KINDS, MIME_EXT, MAX_ASSET_BYTES, isSafeFileName } from "./asset-kinds";

// Re-exported so server callers keep one import site for "everything about an
// asset", while the client imports the constants directly from asset-kinds.
export { ASSET_KINDS, MIME_EXT, MAX_ASSET_BYTES, isSafeFileName };

/* Files for QR Registration live on the persistent volume, never in SQLite.

   Two kinds, kept in separate folders because they have different lifetimes and
   different audiences:

   - templates/ : the background, logos and detail strips Karim uploads. Staff
     only, and they last as long as the event does.
   - photos/    : the GENERATED family pictures. A family sees their own via a
     token-gated route. The photo a parent uploaded is never written here, or
     anywhere — it lives in memory for one request and is dropped.

   Filenames are generated ids, never anything a user typed: a name that came
   from a form and then got joined onto a path is how a traversal happens. */

export const TEMPLATE_DIR = path.join(getDataDir(), "uploads", "qr", "templates");
export const PHOTO_DIR = path.join(getDataDir(), "uploads", "qr", "photos");

function ensure(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Decode a data URL into bytes, refusing anything that isn't an image we can
 * hand to Gemini and store.
 */
export function decodeDataUrl(dataUrl, { maxBytes = MAX_ASSET_BYTES } = {}) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) return { ok: false, error: "That needs to be a JPEG, PNG or WebP image." };

  const [, mime, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) return { ok: false, error: "That image came through empty." };
  if (bytes.length > maxBytes) {
    return { ok: false, error: `That image is ${Math.round(bytes.length / 1024 / 1024)} MB — the limit is ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  }
  return { ok: true, mime, bytes, base64 };
}

export function writeTemplate(id, mime, bytes) {
  ensure(TEMPLATE_DIR);
  const fileName = `${id}.${MIME_EXT[mime]}`;
  writeFileSync(path.join(TEMPLATE_DIR, fileName), bytes);
  return fileName;
}

export function writePhoto(id, mime, bytes) {
  ensure(PHOTO_DIR);
  const fileName = `${id}.${MIME_EXT[mime] || "png"}`;
  writeFileSync(path.join(PHOTO_DIR, fileName), bytes);
  return fileName;
}

function readFrom(dir, fileName) {
  if (!isSafeFileName(fileName)) return null;
  const filePath = path.join(dir, fileName);
  return existsSync(filePath) ? readFileSync(filePath) : null;
}

export const readTemplate = (fileName) => readFrom(TEMPLATE_DIR, fileName);
export const readPhoto = (fileName) => readFrom(PHOTO_DIR, fileName);

function removeFrom(dir, fileName) {
  if (!isSafeFileName(fileName)) return;
  const filePath = path.join(dir, fileName);
  // A missing file is the expected case on a re-run, not a failure worth
  // taking a delete action down for.
  if (existsSync(filePath)) unlinkSync(filePath);
}

export const removeTemplate = (fileName) => removeFrom(TEMPLATE_DIR, fileName);
export const removePhoto = (fileName) => removeFrom(PHOTO_DIR, fileName);

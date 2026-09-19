/**
 * Evidence limits, shared by the upload route and the device-side control.
 * No server imports here so the client bundle can read the numbers.
 *
 * An Apps Script web app accepts roughly 50 MB per request, and the file is
 * sent base64-encoded (a third larger on the wire), so the ceiling per clip is
 * kept well under that. Three to four minutes of phone video at 720p, or any
 * photo. A longer recording is uploaded as several clips.
 */
export const MAX_EVIDENCE_BYTES = 45 * 1024 * 1024;

export const EVIDENCE_KINDS = ["video", "photo"];

export const EVIDENCE_MIME = {
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "video/3gpp": "video",
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "image/heic": "photo",
};

/** A thumbnail is a data: URL made on the device; keep it small. */
export const MAX_THUMB_CHARS = 60 * 1024;

export function kindForMime(mime) {
  return EVIDENCE_MIME[String(mime || "").toLowerCase()] || null;
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(b >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/* The client-safe half of the artwork rules.

   Separate from lib/qr/assets.js because that module is `server-only` and
   imports node:fs — and the studio, which is a Client Component, needs the
   slot names and the size ceiling to build its upload control. Importing the
   server module from the client fails the build with an error naming an
   unrelated file, so the constants live here and the file handling lives
   there. */

export const ASSET_KINDS = [
  { kind: "background", label: "Background template" },
  { kind: "event_logo", label: "Event logo" },
  { kind: "company_logo", label: "Company logo" },
  { kind: "sponsor_logo", label: "Sponsor logo" },
  { kind: "detail", label: "Event details" },
  { kind: "extra", label: "Something else" },
];

export const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Comfortably above a downscaled phone photo and well under the 10 MB server
// action ceiling in next.config.mjs, so our own message speaks before Next's.
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

/* Only ever a generated id plus a known extension. Anything else is refused
   before it reaches path.join — the check runs on the way OUT of the database
   as well as in, because a row could predate a rule. */
export function isSafeFileName(name) {
  return typeof name === "string" && /^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(name);
}

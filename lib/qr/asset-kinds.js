/* The client-safe half of the artwork rules.

   Separate from lib/qr/assets.js because that module is `server-only` and
   imports node:fs — and the studio, which is a Client Component, needs the
   slot names and the size ceiling to build its upload control. Importing the
   server module from the client fails the build with an error naming an
   unrelated file, so the constants live here and the file handling lives
   there. */

/* Any of these may be uploaded MORE THAN ONCE — two event logos, three
   sponsors — and each upload can carry its own label, which is what the
   picture generator is told the image is. A fixed one-of-each list would mean
   a second logo had nowhere to go. */
export const ASSET_KINDS = [
  { kind: "background", label: "Background template" },
  { kind: "event_logo", label: "Event logo" },
  { kind: "company_logo", label: "Company logo" },
  { kind: "sponsor_logo", label: "Sponsor logo" },
  { kind: "detail", label: "Event details" },
  { kind: "extra", label: "Something else" },
];

/* The shapes Gemini's image model accepts, named for what they are FOR rather
   than by their numbers — Karim is choosing where the picture gets printed or
   posted, not doing arithmetic. */
export const ASPECT_RATIOS = [
  { value: "4:3", label: "Landscape 4:3", hint: "Prints, slideshows" },
  { value: "3:4", label: "Portrait 3:4", hint: "Photo prints, a family keepsake" },
  { value: "1:1", label: "Square 1:1", hint: "Instagram, WhatsApp display" },
  { value: "16:9", label: "Wide 16:9", hint: "A screen in the hall" },
  { value: "9:16", label: "Tall 9:16", hint: "Stories, phone wallpaper" },
];

export const DEFAULT_ASPECT = "4:3";

export function isAspect(value) {
  return ASPECT_RATIOS.some((r) => r.value === value);
}

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

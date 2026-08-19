/* The optional "how many others are with you" headcount.

   Its own tiny module because both the door and the studio need the same
   ceiling, and lib/qr/queries.js is `server-only` — a client component
   importing it fails the build with an error naming an unrelated file. */

/* Fifty is far past any real family and stops a stray keystroke — or a held
   "+" button — turning one party into a catering order for nine hundred. */
export const MAX_PAX = 50;

/** Any input to a whole number of people between 0 and MAX_PAX. */
export function clampPax(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PAX) : 0;
}

/* Pass tokens and the small pure rules around them.

   Dependency-free and separate from the server actions on purpose: a
   `"use server"` module may only export async functions, so every synchronous
   helper an action needs has to live outside it. Being pure also makes this
   the half of the feature worth unit-testing. */

/* Deliberately ambiguity-free: no I, L, O or U, no 0 or 1. A parent reads this
   back to a volunteer across a noisy hall and types it with one thumb, so
   every pair a human confuses (0/O, 1/I/L, U/V) has one member removed
   entirely. 30 symbols ^ 8 is unguessable at the scale of one event, and short
   enough to print under a QR and say out loud. */
export const TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TOKEN_LENGTH = 8;

const TOKEN_RE = new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`);

/* The per-event cookie remembering this phone's pass. Lives here rather than
   beside the action that sets it because a `"use server"` module may only
   export async functions — a plain `export const` there voids EVERY export in
   the file, and the build error names the importing component rather than the
   constant, so it reads as a broken import somewhere else entirely. */
export const PASS_COOKIE = "lqk_pass";

/** Is this an exact, well-formed pass token? */
export function isToken(value) {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/* Pull a pass token out of whatever arrived — a bare code, a full pass URL, or
   a URL somebody pasted. Matching is case-insensitive because the places these
   get typed uppercase as you type, which also uppercases a pasted URL; a
   case-sensitive "/q/p/" test then drops it silently. */
export function parseToken(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const fromPath = text.match(/\/q\/p\/([^/?#\s]+)/i);
  const candidate = (fromPath ? fromPath[1] : text).toUpperCase();
  // Tolerate the separators people add when reading a code back: "K7M2 XQ9B".
  const cleaned = candidate.replace(/[\s-]+/g, "");
  return isToken(cleaned) ? cleaned : null;
}

/** The printed form — "K7M2 XQ9B" is read aloud far more reliably. */
export function formatToken(token) {
  if (!isToken(token)) return String(token || "");
  return `${token.slice(0, 4)} ${token.slice(4)}`;
}

/* The party's name. A blank family name falls back to the contact, and a blank
   contact to a neutral label rather than an empty row on a staff screen. */
export function partyName(registration) {
  const family = String(registration?.family_name || "").trim();
  if (family) return `The ${family} Family`;
  const contact = String(registration?.contact_name || "").trim();
  return contact || "A family";
}

/* Surnames are guessed from a picked name so the parent usually doesn't have
   to type one. Three cases, in order:

   1. "Rahman, Fatimah" — a spreadsheet's Last, First. The surname is what
      comes BEFORE the comma; taking the last word gives "The Fatimah Family",
      which is a given name.
   2. "Ahmad bin Ismail" — Malay and Arabic names carry bin/binte/ibn before
      the father's name, and the meaningful word is the one AFTER it.
   3. Otherwise the last word.

   A guess, and always editable — which is why it is allowed to be a guess. */
export function guessSurname(fullName) {
  const text = String(fullName || "").trim();
  if (!text) return "";

  const comma = text.indexOf(",");
  if (comma > 0) return text.slice(0, comma).trim().split(/\s+/).pop();

  const parts = text.split(/\s+/).filter(Boolean);
  const marker = parts.findIndex((p) => /^(bin|binti|binte|bt|b\.|ibn)$/i.test(p));
  if (marker !== -1 && parts[marker + 1]) return parts[marker + 1];
  return parts[parts.length - 1];
}

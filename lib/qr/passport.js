/* Pure rules for the QR passport: token shape, the word/booth invariant, and
   reward tiers.

   Separate from the server actions on purpose — a `"use server"` module may
   only export async functions, so every synchronous helper an action needs has
   to live outside it. Being dependency-free also makes this the half of the
   feature that is worth unit-testing. */

/* Deliberately ambiguity-free: no I, L, O or U, no 0 or 1. Volunteers read
   these aloud to each other across a noisy hall and type them into a phone
   with one thumb, so every pair a human confuses (0/O, 1/I/L, U/V) has one
   member removed entirely. 30 symbols ^ 8 ≈ 6.6e11 — unguessable at the scale
   of one event, and short enough to print under the QR and say out loud. */
/* The per-event cookie remembering this phone's pass. It lives HERE rather
   than beside the action that sets it because a `"use server"` module may only
   export async functions — a plain `export const` there voids EVERY export in
   the file, and the build error names the importing component rather than the
   constant, so it reads as a broken import somewhere else entirely. */
export const PASS_COOKIE = "lqk_pass";

export const TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TOKEN_LENGTH = 8;

const TOKEN_RE = new RegExp(`^[${TOKEN_ALPHABET}]{${TOKEN_LENGTH}}$`);

/** Is this an exact, well-formed pass token? */
export function isToken(value) {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/* Pull a pass token out of whatever the booth screen was handed.

   Three things arrive here: a bare code typed by a volunteer, the full URL a
   camera scan yields, and a URL someone pasted. The camera is the common case
   and the manual field is the one that bites — it uppercases as you type (so
   an 8-character code is never half-shifted), which also uppercases a pasted
   URL, and a case-SENSITIVE "/q/p/" test then drops it silently. Every scan
   like that failed to award a letter and said nothing. Matching is
   case-insensitive for exactly that reason; see the regression test.

   Returns the canonical uppercase token, or null. */
export function parseToken(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  // A URL (or anything path-shaped): take the segment after /q/p/.
  const fromPath = text.match(/\/q\/p\/([^/?#\s]+)/i);
  const candidate = (fromPath ? fromPath[1] : text).toUpperCase();

  // Tolerate the separators people add when reading a code back: "K7M2 XQ9B".
  const cleaned = candidate.replace(/[\s-]+/g, "");
  return isToken(cleaned) ? cleaned : null;
}

/** Group a token for display — "K7M2 XQ9B" is read aloud far more reliably. */
export function formatToken(token) {
  if (!isToken(token)) return String(token || "");
  return `${token.slice(0, 4)} ${token.slice(4)}`;
}

/* ---- the word ----------------------------------------------------------- */

/** Letters of the collection word, uppercase, non-letters stripped. */
export function wordLetters(word) {
  return String(word || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .split("");
}

/* The invariant that quietly breaks an event: the word's length MUST equal the
   booth count. One booth too few and the word can never complete, so no family
   ever reaches the top tier; one too many and a booth awards nothing. It is
   checked here and surfaced in the studio rather than left as a comment,
   because it is only discovered on the day otherwise. */
export function wordFits(word, boothCount) {
  return wordLetters(word).length === boothCount;
}

/* ---- reward tiers ------------------------------------------------------- */

/* Tiers are stored as JSON on the event row so they can change on the morning
   of the event without a migration — the prize table is the single most
   likely thing to change late. */
export function parseTiers(json) {
  let raw;
  try {
    raw = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((tier) => ({
      // NOT clamped up to 1: a threshold of 0 is a mistake, and clamping it
      // would sneak it past the filter below as a tier every family has
      // already earned — i.e. a prize claimable before visiting anything.
      at: Math.round(Number(tier?.at) || 0),
      label: String(tier?.label || "").trim().slice(0, 80),
    }))
    .filter((tier) => tier.at > 0 && tier.label)
    .sort((a, b) => a.at - b.at);
}

export function serializeTiers(tiers) {
  return JSON.stringify(parseTiers(JSON.stringify(tiers)));
}

/**
 * The tier list annotated for one family: earned (threshold met), and given
 * (already handed over). `claimed` is a Set of tier indexes.
 */
export function tierState(tiers, collected, claimed) {
  return tiers.map((tier, index) => ({
    ...tier,
    index,
    earned: collected >= tier.at,
    given: claimed.has(index),
    remaining: Math.max(0, tier.at - collected),
  }));
}

/** The best tier a family may collect right now, or null. */
export function nextClaimable(tiers, collected, claimed) {
  const state = tierState(tiers, collected, claimed);
  const ready = state.filter((tier) => tier.earned && !tier.given);
  return ready.length ? ready[ready.length - 1] : null;
}

/* The family's public name on the leaderboard, which goes on a TV in the hall.
   NEVER a child's name — the board is visible to a room full of strangers and
   nobody consented to that. A blank nickname falls back to the surname, and a
   blank surname to a neutral label rather than an empty row. */
export function displayName(family) {
  const nickname = String(family?.nickname || "").trim();
  if (nickname) return nickname;
  const surname = String(family?.surname || "").trim();
  return surname ? `The ${surname} Family` : "A family";
}

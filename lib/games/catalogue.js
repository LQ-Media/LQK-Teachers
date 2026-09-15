/**
 * The games, and what each one is for.
 *
 * One list, used by the hub tiles, the route resolver and the page titles, so a
 * new game is added in exactly one place. `sense` names the channels a game
 * works — it is shown on the tile, because a teacher choosing between four
 * games wants to know which one drills listening and which one drills the hand.
 */
export const GAMES = [
  {
    slug: "trace-say",
    title: "Trace & Say",
    tagline: "Trace the letter, hear its name",
    blurb:
      "The letter glows in behind a finger, stroke by stroke, then says its name. All 28 huruf in flashcard order.",
    sense: ["Touch", "Listen", "See"],
    icon: "feather",
    tone: "sage",
  },
  {
    slug: "harakah-lab",
    title: "Harakah Lab",
    tagline: "Fatha, kasra, damma — and what they do",
    blurb:
      "Tap a harakah and watch it fly onto the letter: the mark and the change in sound arrive from the same touch.",
    sense: ["Listen", "See"],
    icon: "sparkles",
    tone: "honey",
  },
  {
    slug: "hear-touch",
    title: "Hear & Touch",
    tagline: "Listen, then find the letter",
    blurb:
      "A sound plays and four letters wait. The wrong ones are the letters children really confuse, so it cannot be won by guessing.",
    sense: ["Listen", "Touch"],
    icon: "volume-2",
    tone: "clay",
  },
  {
    slug: "three-places",
    title: "Three Places",
    tagline: "One letter, three shapes",
    blurb:
      "Trace each letter as it appears at the start, middle and end of a word — joins and all — and hear that it is still the same letter.",
    sense: ["Touch", "See", "Listen"],
    icon: "book-marked",
    tone: "clay",
  },
  {
    slug: "word-blend",
    title: "Word Blending",
    tagline: "Join the letters into a word",
    blurb:
      "The 12 combination cards. Touch each letter in reading order and the syllables join into the whole word.",
    sense: ["Touch", "Listen", "See"],
    icon: "layers",
    tone: "sage",
  },
];

export function game(slug) {
  return GAMES.find((g) => g.slug === slug) ?? null;
}

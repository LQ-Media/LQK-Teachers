import { MEANINGS } from "./word-meanings.js";
import { QURAN_CARDS, QURAN_GLOSS, ayahOf } from "./quran-words.js";

/**
 * The 12 combination cards from the back of the flashcard deck.
 *
 * These are blending drills, not vocabulary: the point is to read a string of
 * letters you already know with the harakat you already know, so some cards are
 * real words (سَجَدَ، رَكَعَ، اَكَلَ) and some are deliberate nonsense built from
 * letters that are easy to confuse (ثَمَسَ، سَصَجَ، دَضَنَ). The deck itself gives
 * no translations; see MEANINGS below for how this file handles that.
 *
 * Two characters are normalised from the deck, where they were typed with the
 * Persian forms: ی (U+06CC) → ي and ھ (U+06BE) → ه. They render almost
 * identically but a child tracing ي should meet the same codepoint everywhere
 * in the portal.
 *
 * MEANINGS
 *
 * English glosses live in word-meanings.js, keyed by the Arabic word, and the
 * file starts EMPTY on purpose. Some of these cards are real words
 * (سَجَدَ، رَكَعَ، اَكَلَ) and some are deliberate nonsense built from confusable
 * letters (ثَمَسَ، سَصَجَ، دَضَنَ), so a gloss cannot be generated for all of them
 * and guessing at one in a Quran class is worse than showing none. The game
 * shows a meaning only where the file has one; anything else stays as it is.
 */

export const WORD_CARDS = [
  { id: 1, words: ["بَنَتَ", "بُنِتَ", "بَنَيَ", "بَنِيُ"] },
  { id: 2, words: ["نَجَحَ", "نُجِحُ", "هُجِمَ", "هَجَمَ"] },
  { id: 3, words: ["ثَمَسَ", "ثَمِسُ", "شُمَسِ", "شَمَسَ"] },
  { id: 4, words: ["صَرَطَ", "صِرَطُ", "سَصَجَ", "سِصِجُ"] },
  { id: 5, words: ["دَضَنَ", "دُضِنُ", "سِدِضِ", "سَدَضَ"] },
  { id: 6, words: ["ذَبَحَ", "ذُبِحَ", "زِرَفُ", "زَرَفَ"] },
  { id: 7, words: ["اَنَعَ", "اَنِعَ", "بُيِعَ", "بَيَعَ"] },
  { id: 8, words: ["غَيَبَ", "غَيِبُ", "رِمِيُ", "رَمَيَ"] },
  { id: 9, words: ["سَجَدَ", "سُجِدَ", "رَكِعُ", "رَكَعَ"] },
  { id: 10, words: ["سَطَحَ", "سُطِحُ", "ظِلَمَ", "ظَلِمَ"] },
  { id: 11, words: ["فَلَحَ", "فَلِحُ", "قُرِاَ", "قَرَاَ"] },
  { id: 12, words: ["اَكَلَ", "اُكِلَ", "سُمِكُ", "سَمَكَ"] },
];

// Fatha, kasra, damma, plus the marks that can legitimately show up in these
// drills (sukun, shadda, the maddah/hamza sitting on an alif).
const MARKS = /[ً-ْٓ-ٰٕ]/;

/**
 * Split a harakat'd word into its readable units: each base letter carries its
 * own marks. "سَجَدَ" → ["سَ", "جَ", "دَ"].
 *
 * This is what makes blending teachable — the game lights and voices one unit
 * at a time, which is exactly how a child is taught to read the card, rather
 * than showing the whole word at once and hoping.
 */
export function syllables(word) {
  const out = [];
  for (const ch of word) {
    if (MARKS.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** Every drill word, flattened, in deck order. */
export function allWords() {
  return WORD_CARDS.flatMap((c) => c.words);
}

/**
 * The two sets of cards the game can show.
 *
 * The printed deck stays first and stays exactly as it is — it is the school's
 * own material, the cards the children hold in their hands, and half of it is
 * deliberate nonsense because confusable letters are what it drills.
 *
 * "Quran words" is the answer to a different ask: three-letter words that fuse
 * letters and harakat AND mean something, so a child learns vocabulary while
 * spelling. Every one is mined from the Uthmani text and carries its ayah, so
 * it is a real word by construction rather than by a dictionary lookup that
 * a classroom tablet could not make offline anyway. See quran-words.js.
 *
 * Both sets are four words per card, which is what lets the game page through
 * them with one index.
 */
export const CARD_SETS = [
  {
    id: "deck",
    label: "Deck",
    hint: "The 12 printed combination cards",
    cards: WORD_CARDS.map((c) => ({ ...c, title: `Card ${c.id}` })),
  },
  {
    id: "quran",
    label: "Quran words",
    hint: "Three-letter words from the mushaf, with their meaning",
    cards: QURAN_CARDS,
  },
];

export function cardSet(id) {
  return CARD_SETS.find((s) => s.id === id) ?? CARD_SETS[0];
}

/**
 * The English meaning of a word, or null when there is none recorded.
 *
 * Null is the normal answer for the printed deck: several of those cards are
 * nonsense drills by design, and MEANINGS is empty rather than guessed at. The
 * Quran set always has one, because a word does not get onto a card there
 * without a gloss.
 */
export function meaningOf(word) {
  const found = MEANINGS[word] ?? QURAN_GLOSS[word];
  return typeof found === "string" && found.trim() ? found.trim() : null;
}

/** The ayah a word comes from, for the Quran set, or null for a deck drill. */
export { ayahOf };

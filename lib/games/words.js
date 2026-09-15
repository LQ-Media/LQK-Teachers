/**
 * The 12 combination cards from the back of the flashcard deck.
 *
 * These are blending drills, not vocabulary: the point is to read a string of
 * letters you already know with the harakat you already know, so some cards are
 * real words (سَجَدَ، رَكَعَ، اَكَلَ) and some are deliberate nonsense built from
 * letters that are easy to confuse (ثَمَسَ، سَصَجَ، دَضَنَ). The deck gives no
 * translations and neither does this file — adding meanings would mean inventing
 * them for the nonsense drills, and guessing at a translation in a Quran class
 * is worse than leaving it out.
 *
 * Two characters are normalised from the deck, where they were typed with the
 * Persian forms: ی (U+06CC) → ي and ھ (U+06BE) → ه. They render almost
 * identically but a child tracing ي should meet the same codepoint everywhere
 * in the portal.
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

/**
 * English meanings for the blending drill words, keyed by the Arabic word.
 *
 * EMPTY ON PURPOSE.
 *
 * Roughly half of the deck's 48 combinations are real words (سَجَدَ، رَكَعَ،
 * اَكَلَ) and the rest are deliberate nonsense built from confusable letters
 * (ثَمَسَ، سَصَجَ، دَضَنَ، سِدِضِ). A gloss therefore cannot exist for all of them,
 * and inventing one for a nonsense drill — or guessing at a real one — is worse
 * in a Quran class than showing nothing. Word Blending displays a meaning only
 * where this file has one.
 *
 * Fill it from a dictionary you trust, or have an ustazah write it: 48 entries
 * is twenty minutes of a teacher's time and it is then permanently correct,
 * offline, and free of any runtime dependency. A plain module rather than JSON
 * so that it loads identically under Next and under `node --test`, with no
 * import attributes and no path aliases.
 *
 * Passives are worth a thought when filling this in: the deck pairs an active
 * with its passive (سَجَدَ / سُجِدَ، ذَبَحَ / ذُبِحَ), and "he prostrated" versus
 * "he was prostrated to" is a distinction a five-year-old will not take from a
 * caption. Keep them short, or leave the passive blank.
 */
export const MEANINGS = {};

import assert from "node:assert/strict";
import { test } from "node:test";

import { QURAN_CORPUS, attested } from "../lib/games/quran-corpus.js";
import {
  QURAN_CARDS,
  QURAN_GLOSS,
  ayahOf,
  countOf,
  curatedWords,
  unattested,
  unglossed,
} from "../lib/games/quran-words.js";
import { CARD_SETS, cardSet, meaningOf, syllables } from "../lib/games/words.js";
import { screenWord } from "../lib/games/clean-words.js";
import { HARAKAT, HURUF, sayFor } from "../lib/games/huruf.js";

const FATHA = "َ";
const KASRA = "ِ";
const DAMMA = "ُ";
const MARKS = new Set([FATHA, KASRA, DAMMA]);
const LETTERS = new Set(HURUF.map((h) => h.char));
const BY_CHAR = new Map(HURUF.map((h) => [h.char, h]));
const BY_MARK = new Map(HARAKAT.map((h) => [h.mark, h]));

/** The same transliteration the game shows, used to screen a word here. */
function latinOf(word) {
  return syllables(word)
    .map((u) => {
      const [ch, ...rest] = [...u];
      const letter = BY_CHAR.get(ch);
      const mark = rest.map((c) => BY_MARK.get(c)).find(Boolean);
      return letter && mark ? sayFor(letter, mark.id) : ch;
    })
    .join("-");
}

/* ------------------------------------------------------------------ corpus */

test("the corpus is non-trivial and every entry is well formed", () => {
  assert.ok(QURAN_CORPUS.length > 200, `only ${QURAN_CORPUS.length} words mined`);
  for (const e of QURAN_CORPUS) {
    assert.match(e.ref, /^\d{1,3}:\d{1,3}$/, `bad ref on ${e.word}`);
    assert.ok(e.count >= 1, `bad count on ${e.word}`);
  }
});

test("every corpus word is three letters, each with exactly one harakah", () => {
  // This is the whole contract of the mining run: a word a child who knows the
  // 28 huruf and the three marks can read, with nothing else in it.
  for (const { word } of QURAN_CORPUS) {
    const chars = [...word];
    assert.equal(chars.length, 6, `${word} is not three letter+mark pairs`);
    for (let i = 0; i < 6; i += 2) {
      assert.ok(LETTERS.has(chars[i]), `${word} has a non-letter at ${i}`);
      assert.ok(MARKS.has(chars[i + 1]), `${word} has a non-harakah at ${i + 1}`);
    }
  }
});

test("no corpus word carries a sukun, shadda, tanwin or madd", () => {
  // The marks this deck has not taught. A word with one of them is not
  // readable by the child this game is for, and the tanwin case in particular
  // once produced رَجُلُ — a truncation of رَجُلٌ that is in no mushaf.
  const forbidden = /[ًٌٍّْٰٕٓٔۢۥۦۭ۟۠ۜ]/;
  for (const { word } of QURAN_CORPUS) {
    assert.ok(!forbidden.test(word), `${word} carries a mark the deck has not taught`);
  }
});

test("the corpus has no duplicate words", () => {
  const seen = new Set();
  for (const { word } of QURAN_CORPUS) {
    assert.ok(!seen.has(word), `${word} appears twice`);
    seen.add(word);
  }
});

test("attested() finds mined words and rejects invented ones", () => {
  assert.ok(attested("خَلَقَ"), "خَلَقَ is in the Quran and should be attested");
  // Real letters, real harakat, not a word: the exact failure mode the corpus
  // exists to catch.
  assert.equal(attested("خَلَقُ"), null);
  assert.equal(attested("بَبَبَ"), null);
});

/* ----------------------------------------------------------------- curation */

test("NO CURATED WORD IS UNATTESTED", () => {
  // The guard that makes the feature trustworthy. A mistyped harakah in
  // quran-words.js renders perfectly and teaches a word that does not exist;
  // this is what stops it reaching a child.
  assert.deepEqual(unattested(), []);
});

test("every curated word has an English gloss", () => {
  assert.deepEqual(unglossed(), []);
});

test("every card has exactly four words", () => {
  // The game pages through both sets with one flat index and a divisor of 4.
  for (const card of QURAN_CARDS) {
    assert.equal(card.words.length, 4, `${card.id} has ${card.words.length} words`);
  }
});

test("no card repeats a word, and no two cards share an id", () => {
  const ids = new Set();
  for (const card of QURAN_CARDS) {
    assert.ok(!ids.has(card.id), `duplicate card id ${card.id}`);
    ids.add(card.id);
    assert.equal(new Set(card.words).size, 4, `${card.id} repeats a word`);
  }
});

test("every card has a title for the teacher", () => {
  for (const card of QURAN_CARDS) {
    assert.ok(card.title && card.title.trim().length > 2, `${card.id} has no title`);
  }
});

test("every glossed word is actually used on a card", () => {
  // A gloss for a word no card shows is dead weight that will drift out of
  // date unnoticed.
  const used = new Set(curatedWords());
  for (const word of Object.keys(QURAN_GLOSS)) {
    assert.ok(used.has(word), `${word} is glossed but on no card`);
  }
});

test("EVERY CURATED WORD PASSES THE EXPLETIVE SCREEN", () => {
  // The screen runs at mining time, but the curated list is edited by hand
  // afterwards and a teacher adding a word will not re-run the miner.
  for (const word of curatedWords()) {
    const verdict = screenWord(word, latinOf(word));
    assert.ok(
      verdict.clean,
      `${word} (${latinOf(word)}) hits ${verdict.lang} "${verdict.matched}" via ${verdict.surface}`,
    );
  }
});

test("the active/passive cards really do contrast the same letters", () => {
  // Six cards exist to reproduce the printed deck's minimal-pair trick with
  // real words. If a pair stops sharing its consonants the card is pointless,
  // so it is worth pinning rather than trusting.
  const bare = (w) => [...w].filter((c) => LETTERS.has(c)).join("");
  const pairs = [
    ["خَلَقَ", "خُلِقَ"],
    ["كَتَبَ", "كُتِبَ"],
    ["جَعَلَ", "جُعِلَ"],
    ["فَعَلَ", "فُعِلَ"],
    ["وَعَدَ", "وُعِدَ"],
    ["وَجَدَ", "وُجِدَ"],
    ["ضَرَبَ", "ضُرِبَ"],
    ["مَنَعَ", "مُنِعَ"],
    ["ظَلَمَ", "ظُلِمَ"],
    ["عَرَضَ", "عُرِضَ"],
  ];
  const used = new Set(curatedWords());
  for (const [active, passive] of pairs) {
    assert.equal(bare(active), bare(passive), `${active} / ${passive} differ in letters`);
    assert.notEqual(active, passive);
    assert.ok(attested(active) && attested(passive), `${active} / ${passive} not both mined`);
    assert.ok(used.has(active) && used.has(passive), `${active} / ${passive} not both on a card`);
  }
});

test("the curated set spans all three harakat in every position", () => {
  // "Fusing different letters and harakah" is the point of the set. If the
  // curation drifted to all-fatha words it would be a worse drill than the
  // printed deck, so each slot must really see all three marks.
  for (const slot of [0, 1, 2]) {
    const marks = new Set(curatedWords().map((w) => [...w][slot * 2 + 1]));
    assert.deepEqual(
      [...marks].sort(),
      [FATHA, DAMMA, KASRA].sort(),
      `letter ${slot + 1} never takes all three harakat`,
    );
  }
});

test("the curated set uses a wide spread of letters", () => {
  const letters = new Set(curatedWords().flatMap((w) => [...w].filter((c) => LETTERS.has(c))));
  assert.ok(letters.size >= 20, `only ${letters.size} distinct letters across the cards`);
});

test("ayahOf and countOf report the mushaf, not a guess", () => {
  assert.equal(ayahOf("خَلَقَ"), "2:29");
  assert.equal(ayahOf("مَلِكِ"), "114:2");
  assert.ok(countOf("خَلَقَ") > 10);
  assert.equal(ayahOf("بَبَبَ"), null);
  assert.equal(countOf("بَبَبَ"), 0);
});

/* --------------------------------------------------------------- both sets */

test("both card sets are offered and the deck comes first", () => {
  assert.equal(CARD_SETS.length, 2);
  assert.equal(CARD_SETS[0].id, "deck");
  assert.equal(CARD_SETS[1].id, "quran");
  for (const s of CARD_SETS) {
    assert.ok(s.label && s.hint, `${s.id} is missing its label or hint`);
    assert.ok(s.cards.length > 0);
    for (const card of s.cards) {
      assert.equal(card.words.length, 4, `${s.id}/${card.id} has ${card.words.length} words`);
      assert.ok(card.title, `${s.id}/${card.id} has no title`);
    }
  }
});

test("cardSet falls back to the deck for an unknown id", () => {
  // The id comes out of localStorage, so a stale or hand-edited value must not
  // leave a classroom tablet with an empty screen.
  assert.equal(cardSet("quran").id, "quran");
  assert.equal(cardSet("nonsense").id, "deck");
  assert.equal(cardSet(undefined).id, "deck");
});

test("the printed deck is untouched by any of this", () => {
  // The deck is the school's own material. 12 cards, 4 words each, and no
  // meaning invented for the nonsense drills.
  const deck = cardSet("deck");
  assert.equal(deck.cards.length, 12);
  assert.equal(deck.cards[0].words[0], "بَنَتَ");
  assert.equal(meaningOf("ثَمَسَ"), null, "a nonsense drill must not acquire a gloss");
});

test("meaningOf reads the Quran glosses as well as the deck's", () => {
  assert.equal(meaningOf("خَلَقَ"), "he created");
  assert.equal(meaningOf("كُتِبَ"), "it was written");
  assert.equal(meaningOf("بَبَبَ"), null);
});

test("syllables splits a Quran word into three touchable units", () => {
  assert.deepEqual(syllables("خَلَقَ"), ["خَ", "لَ", "قَ"]);
  assert.deepEqual(syllables("كُتِبَ"), ["كُ", "تِ", "بَ"]);
  for (const word of curatedWords()) {
    assert.equal(syllables(word).length, 3, `${word} does not split into three units`);
  }
});

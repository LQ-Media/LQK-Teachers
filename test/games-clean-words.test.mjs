import test from "node:test";
import assert from "node:assert/strict";

import { screenWord, keepClean, blockedByLanguage } from "../lib/games/clean-words.js";
import { allWords, syllables } from "../lib/games/words.js";
import { HARAKAT, HURUF, sayFor } from "../lib/games/huruf.js";

/* The deck's own transliteration of a word, assembled the way the game does. */
const BY_CHAR = new Map(HURUF.map((h) => [h.char, h]));
const BY_MARK = new Map(HARAKAT.map((h) => [h.mark, h]));
function latinOf(word) {
  return syllables(word)
    .map((unit) => {
      const chars = [...unit];
      const letter = BY_CHAR.get(chars[0]);
      const mark = chars.slice(1).map((c) => BY_MARK.get(c)).find(Boolean);
      return letter && mark ? sayFor(letter, mark.id) : (letter?.name ?? unit);
    })
    .join("");
}

test("the collisions this filter exists for are blocked", () => {
  // Every one of these is reachable from three letters and three harakat.
  const cases = [
    ["كَنِنَا", "KaNiNa", "hokkien"],
    ["بَبِي", "BaBi", "malay"],
    ["شِتُ", "ShiTu", "english"],
  ];
  for (const [arabic, latin, lang] of cases) {
    const r = screenWord(arabic, latin);
    assert.equal(r.clean, false, `${latin} should be blocked`);
    assert.equal(r.lang, lang, `${latin} should be attributed to ${lang}`);
  }
});

test("a revowelled frame is blocked too", () => {
  // An Arabic drill chooses its vowels freely, so blocking only the exact
  // vowelling would be trivially defeated by the next card.
  const r = screenWord("قَنِنَا", "QoNiNa");
  assert.equal(r.clean, false);
  assert.equal(r.surface, "frame");

  // ...but only where the frame is specific enough. Two consonants is not:
  // b-d would take عَبَدَ (to worship) and بَدَلَ with it.
  assert.equal(screenWord("عَبَدَ", "ʿAbaDa").clean, true, "عَبَدَ must survive");
  assert.equal(screenWord("بَدَلَ", "BaDaLa").clean, true, "بَدَلَ must survive");
});

test("the transliteration is screened, not just the Arabic", () => {
  // The Arabic here is unremarkable; what a child says aloud is not.
  const r = screenWord("بَبِي", "BaBi");
  assert.equal(r.clean, false);
  assert.equal(r.surface, "transliteration");
});

test("coarse Arabic roots are screened in the Arabic", () => {
  const r = screenWord("خَرَا", "KhoRoA");
  assert.equal(r.clean, false);
  assert.equal(r.surface, "arabic");
  assert.equal(r.lang, "arabic");
});

test("ordinary drill words pass", () => {
  for (const [arabic, latin] of [
    ["سَجَدَ", "SaJaDa"],
    ["رَكَعَ", "RaKaʿA"],
    ["فَلَحَ", "FaLaHa"],
    ["اَكَلَ", "AKaLa"],
    ["نَجَحَ", "NaJaHa"],
  ]) {
    assert.equal(screenWord(arabic, latin).clean, true, `${latin} should pass`);
  }
});

test("every word in the printed deck survives the filter", () => {
  // The guard that matters. Over-blocking a word the game GENERATED is free;
  // a word quietly vanishing from the flashcard deck is a regression, and it
  // has happened once already — a speculative "shut" entry folded to "sut"
  // and rejected سُطِحُ.
  const rejected = allWords()
    .map((w) => [w, latinOf(w), screenWord(w, latinOf(w))])
    .filter(([, , r]) => !r.clean)
    .map(([w, latin, r]) => `${w} (${latin}) matched "${r.matched}"`);

  assert.deepEqual(rejected, [], `deck words were filtered:\n  ${rejected.join("\n  ")}`);
  assert.equal(allWords().length, 48);
});

test("keepClean filters a list and keeps the rest", () => {
  const words = ["سَجَدَ", "كَنِنَا", "رَكَعَ"];
  const latin = { "سَجَدَ": "SaJaDa", "كَنِنَا": "KaNiNa", "رَكَعَ": "RaKaʿA" };
  assert.deepEqual(keepClean(words, (w) => latin[w]), ["سَجَدَ", "رَكَعَ"]);
});

test("the filter covers all four languages that were asked for", () => {
  const byLang = blockedByLanguage();
  for (const lang of ["english", "malay", "arabic"]) {
    assert.ok(byLang[lang]?.length, `no ${lang} entries`);
  }
  // Chinese was asked for as one language; the terms a Singapore classroom
  // would actually hear are Hokkien and Cantonese rather than Mandarin.
  assert.ok(
    (byLang.hokkien?.length ?? 0) + (byLang.cantonese?.length ?? 0) > 0,
    "no Chinese-dialect entries",
  );
});

test("screenWord copes with no transliteration at all", () => {
  assert.equal(screenWord("سَجَدَ").clean, true);
  assert.equal(screenWord("").clean, true);
});

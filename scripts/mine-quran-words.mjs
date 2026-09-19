#!/usr/bin/env node
/**
 * Mine the Quran for three-letter blending words.
 *
 * WHY THIS AND NOT A DICTIONARY API
 *
 * The brief was "ensure all word combinations are proper Arabic words". An
 * Arabic dictionary API is the obvious way to do that and the wrong one, for
 * four reasons that all bite in this particular game:
 *
 *   1. The games run offline in a classroom. A card that needs a network round
 *      trip to know whether it may be shown is a card that cannot be shown on
 *      the tablet that matters.
 *   2. A dictionary answers "is this a word", not "is this a word a six year
 *      old should read". Arabic dictionaries are complete: they contain the
 *      coarse vocabulary this deck must never produce.
 *   3. Dictionary headwords are unvocalised. Knowing that ك-ت-ب is a root says
 *      nothing about whether كُتِبَ is the reading printed on the card, and the
 *      harakat are the entire point of the exercise.
 *   4. No free Arabic dictionary API has a stability guarantee worth building a
 *      teaching tool on.
 *
 * The Quran solves all four at once. It is a fixed, fully vocalised corpus of
 * about 78,000 words that this school already teaches, it is free, and a word
 * taken from it is by construction a real Arabic word in a real reading — with
 * an ayah reference, so an ustazah can check any card against the mushaf in
 * front of her. And a child who blends خَلَقَ here meets it again in class.
 *
 * WHAT IT EXTRACTS
 *
 * Words of exactly three letters where every letter carries exactly one of
 * fatha, kasra or damma — which is precisely the deck's own alphabet of marks.
 * Anything with a sukun, shadda, madd, tanwin, hamza or superscript alif is
 * rejected, not because those words are lesser but because this deck has not
 * taught those marks yet. That leaves roughly 230 distinct words, every one of
 * which fuses three letters with three freely chosen harakat.
 *
 * Each candidate then goes through screenWord() from clean-words.js before it
 * is written out, so the expletive filter runs at authoring time and not in
 * front of a class.
 *
 * WHAT IT WRITES
 *
 * lib/games/quran-corpus.js — generated, not edited by hand. It is the evidence
 * file: word, occurrence count, and the first ayah each word appears in.
 * Choosing which of those words to teach, and glossing them, is a separate
 * hand-curated step in lib/games/quran-words.js, which can only name words
 * this file attests. That split is the safety property of the whole feature:
 * curation cannot invent a word, and the mining cannot promote one.
 *
 * RUNNING IT
 *
 *   node scripts/mine-quran-words.mjs
 *
 * It needs network access, which is why the output is committed: the build and
 * the tests never fetch anything. Re-run it only to change the extraction
 * rules; the text itself does not change.
 */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { FATHA, KASRA, DAMMA, HARAKAT, HURUF, sayFor } from "../lib/games/huruf.js";
import { screenWord } from "../lib/games/clean-words.js";

/* The Tanzil Uthmani text, which is the text this portal already reads
   elsewhere, mirrored as one JSON file. Pinned to a tag rather than a branch so
   a re-run a year from now mines the same text, and checksummed below so that
   if it ever does change, the run says so instead of quietly producing
   different cards. */
const SOURCE =
  "https://raw.githubusercontent.com/risan/quran-json/v3.1.2/dist/quran.json";
const EXPECT_SHA256 =
  process.env.LQK_QURAN_SHA256 ||
  "d8a8adff387f60ce3ff7dbe3238dd9b27120bfe29d8fcb07ad2e89cad37cefd4";

const MARK_OF = new Map(HARAKAT.map((h) => [h.mark, h]));
const LETTER_OF = new Map(HURUF.map((h) => [h.char, h]));

/* The waqf and sajdah signs — where a reciter may or must pause, and where to
   prostrate. They attach to the end of the last word before the pause and say
   nothing about how its letters are pronounced, so they are stripped.
 *
 * NOTHING ELSE is stripped, and that restraint is load-bearing. An earlier
 * version of this script also cleared the small high meem (U+06E2), reasoning
 * that it was a pronunciation hint. It is not: it marks the iqlab of a TANWIN,
 * so رَجُلُۢ in 23:25 is رَجُلٌ — "a man", nunated — and clearing the meem
 * silently turned it into a three-letter word "Ra-Ju-Lu" that no mushaf
 * contains. It reached a card before a spot-check against the verse caught it.
 * The same trap holds for the silent-letter zeros, the small waw and yeh of a
 * long vowel, and the superscript vowels: each one means the written word is
 * not the three sounds it appears to be. They all disqualify now.
 *
 * U+06DC, the small high seen, is deliberately NOT in the set either: it is a
 * variant reading rather than a pause, and it really does sit mid-word
 * (\u0648\u064E\u064A\u064E\u0628\u06E1\u0635\u064F\u06DC\u0637\u064F, 2:245). It falls through to the catch-all in unitsOf and
 * disqualifies the word, which is the right answer \u2014 a word whose
 * pronunciation is annotated is not a word this deck has taught. */
const WAQF = "\u06D6-\u06DB\u06DD\u06DE";
const WAQF_EDGE = new RegExp(`^[${WAQF}]+|[${WAQF}]+$`, "g");
const WAQF_ANY = new RegExp(`[${WAQF}]`);

/**
 * Split a raw Quranic word into letter+harakah units, or return null if it is
 * not three letters each carrying exactly one of the three marks.
 *
 * Returning null for almost everything is the point: this is a sieve with a
 * very small hole, and the words that fall through are exactly the ones a child
 * who knows the 28 letters and three harakat can already read.
 */
function unitsOf(raw) {
  /* A waqf sign sits at the edge of a token — trailing for the pause marks,
     and leading for the rub-el-hizb ۞, which the text attaches to the front of
     the word that begins the section. Anywhere else means this script is
     misreading the text, and it must not guess: that is the shape the
     tanwin-meem bug had, and an assertion is cheaper than another spot-check. */
  const trimmed = raw.replace(WAQF_EDGE, "");
  if (WAQF_ANY.test(trimmed)) {
    throw new Error(`waqf sign inside a word: ${JSON.stringify(raw)}`);
  }

  const units = [];
  for (const ch of trimmed) {
    if (LETTER_OF.has(ch)) {
      units.push({ letter: LETTER_OF.get(ch), mark: null });
      continue;
    }
    if (ch === FATHA || ch === KASRA || ch === DAMMA) {
      const last = units[units.length - 1];
      // A mark with no letter before it, or a letter already marked (which is
      // what a shadda+harakah pair looks like once the shadda is gone), is not
      // something this deck teaches.
      if (!last || last.mark) return null;
      last.mark = MARK_OF.get(ch);
      continue;
    }
    return null;
  }
  if (units.length !== 3) return null;
  if (units.some((u) => !u.mark)) return null;
  return units;
}

/** "خَلَقَ" → "Kho-La-Qo", using the deck's own tafkhim transliterations. */
function transliterate(units) {
  return units.map((u) => sayFor(u.letter, u.mark.id)).join("-");
}

async function main() {
  process.stdout.write(`Fetching ${SOURCE}\n`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = await res.text();

  const sha = createHash("sha256").update(body).digest("hex");
  process.stdout.write(`  ${body.length} bytes, sha256 ${sha}\n`);
  if (EXPECT_SHA256 && sha !== EXPECT_SHA256) {
    throw new Error(
      `source text changed (expected ${EXPECT_SHA256}) — review it before regenerating`,
    );
  }

  const surahs = JSON.parse(body);
  if (!Array.isArray(surahs) || surahs.length !== 114) {
    throw new Error(`expected 114 surahs, got ${surahs?.length}`);
  }

  const found = new Map();
  let scanned = 0;
  for (const surah of surahs) {
    for (const verse of surah.verses) {
      for (const raw of verse.text.split(/\s+/).filter(Boolean)) {
        scanned += 1;
        const units = unitsOf(raw);
        if (!units) continue;
        const word = units.map((u) => u.letter.char + u.mark.mark).join("");
        const entry = found.get(word);
        if (entry) {
          entry.count += 1;
          continue;
        }
        found.set(word, {
          word,
          say: transliterate(units),
          count: 1,
          ref: `${surah.id}:${verse.id}`,
        });
      }
    }
  }

  /* The filter runs here, at authoring time, so a rejected word never reaches
     the repo — and so its rejection is visible in this report rather than
     being discovered by a teacher. */
  const kept = [];
  const dropped = [];
  for (const entry of found.values()) {
    const verdict = screenWord(entry.word, entry.say);
    (verdict.clean ? kept : dropped).push({ ...entry, verdict });
  }
  kept.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  process.stdout.write(
    `\nScanned ${scanned} words, found ${found.size} readable with three letters\n`,
  );
  process.stdout.write(`  kept    ${kept.length}\n`);
  process.stdout.write(`  screened out ${dropped.length}\n`);
  for (const d of dropped) {
    process.stdout.write(
      `    ${d.word} (${d.say}) — ${d.verdict.lang} "${d.verdict.matched}" via ${d.verdict.surface}\n`,
    );
  }

  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "games", "quran-corpus.js");
  await writeFile(out, render(kept, { sha, scanned, dropped: dropped.length }), "utf8");
  process.stdout.write(`\nWrote ${out}\n`);
}

function render(kept, meta) {
  const rows = kept
    .map((e) => `  ["${e.word}", ${e.count}, "${e.ref}"],`)
    .join("\n");
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Every three-letter word in the Quran whose letters each carry exactly one
 * fatha, kasra or damma: the words a child who knows the 28 huruf and the
 * three harakat can already read. Regenerate with
 *
 *   node scripts/mine-quran-words.mjs
 *
 * which explains the extraction rules and why the Quran is the source rather
 * than a dictionary API.
 *
 * Each row is [word, occurrences in the Quran, first ayah]. The reference is
 * there so an ustazah can check any card against the mushaf.
 *
 * This file only ATTESTS words. Which of them are taught, and what they mean,
 * is decided by hand in quran-words.js — and that file can name nothing this
 * one does not list, which is what stops an invented word reaching a child.
 *
 * Source: ${SOURCE}
 *   sha256 ${meta.sha}
 *   ${meta.scanned} words scanned, ${kept.length} kept, ${meta.dropped} screened out
 *   by the expletive filter in clean-words.js.
 */

/** @type {ReadonlyArray<[word: string, count: number, ref: string]>} */
const ROWS = [
${rows}
];

export const QURAN_CORPUS = ROWS.map(([word, count, ref]) => ({ word, count, ref }));

const BY_WORD = new Map(QURAN_CORPUS.map((e) => [e.word, e]));

/** The corpus entry for a word, or null when the Quran does not contain it. */
export function attested(word) {
  return BY_WORD.get(word) ?? null;
}
`;
}

main().catch((err) => {
  process.stderr.write(`\n${err.message}\n`);
  process.exit(1);
});

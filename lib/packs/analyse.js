import "server-only";
import { createDataSource } from "@/lib/quran/data";
import { parseTajweed, rulesPresent, tajweedRule } from "@/lib/quran/tajweed";
import { surahByNumber, sabaqLabel } from "@/lib/quran/surah-list";

/**
 * Work out what a given ayah range actually contains — WITHOUT any AI.
 *
 * This matters for cost and for correctness. Which tajweed rules occur in
 * Al-Fatihah 1–7 is a fact, readable straight out of Quran.com's tajweed
 * markup; asking a language model to list them would be slower, cost tokens,
 * and occasionally invent a rule that isn't there. The model is only asked for
 * the pedagogy (how to teach it), never for the facts.
 */
// Abdullah Muhammad Basmeih — the standard Malay mushaf translation, and the
// one LQK's teachers actually read. The Quran reader defaults to Saheeh
// International (English); packs are written for a Malay-speaking teaching
// team, so they ground on the Malay text instead.
const MALAY_TRANSLATION_ID = 39;

/**
 * The mistake children typically make on each rule, written once by hand.
 *
 * These used to come from the model, and it got them wrong in a specific and
 * dangerous way: it would name a real word from the ayat and then make a false
 * claim about the letters in it (e.g. "the لا in لَمْ", which has no لا; or
 * "hamzat al-wasl at the start of قُلْ", which has none). The words were real,
 * so the errors read as authoritative. A teacher skimming a pack before class
 * could easily pass one on.
 *
 * Letter-level Arabic analysis is exactly what a general-purpose model is worst
 * at and what a lookup table is perfect for, so the model is no longer asked.
 * Each entry is phrased about the RULE, never about a specific word — true for
 * every portion the rule occurs in.
 */
const RULE_PITFALLS = {
  ham_wasl: "Pronouncing the hamzah when joining from the previous word — it should slide straight through.",
  slnt: "Sounding out letters that are written but not pronounced.",
  laam_shamsiyah: "Pronouncing the laam of ٱل instead of doubling the sun letter that follows it.",
  madda_normal: "Rushing the two counts, or stretching them out to four or six.",
  madda_permissible: "Changing the length from one recitation to the next — pick a length and keep it consistent.",
  madda_necessary: "Cutting the six counts short; this is the one madd that must be held in full.",
  madda_obligatory: "Holding for only two counts instead of four or five.",
  ghunnah: "Losing the nasal sound, or holding it for less than two counts.",
  qalqalah: "Adding a vowel to the echo instead of a clean bounce.",
  ikhafa: "Pronouncing the noon clearly instead of hiding it, or dropping it altogether.",
  ikhafa_shafawi: "Closing the lips fully on the meem instead of hiding it lightly.",
  idgham_ghunnah: "Merging without the nasal sound, or keeping the noon audible.",
  idgham_wo_ghunnah: "Adding a nasal sound where there should be none.",
  idgham_shafawi: "Separating the two meems instead of merging them into one held sound.",
  idgham_mutajanisayn: "Pronouncing both letters separately instead of merging into the second.",
  idgham_mutaqaribayn: "Pronouncing both letters separately instead of merging into the second.",
  iqlab: "Pronouncing the noon as a noon instead of turning it into a meem sound.",
};

/**
 * Common mistakes for a portion, derived from the rules actually detected in
 * its mushaf markup. Returns [] when nothing matches rather than inventing.
 */
export function pitfallsFor(rules) {
  return (rules || []).map((r) => RULE_PITFALLS[r.key]).filter(Boolean).slice(0, 4);
}

export async function analyseRange({ surah, fromAyah, toAyah }) {
  const chapter = surahByNumber(surah);
  if (!chapter) return { ok: false, error: "That surah number doesn't exist." };

  const from = Math.max(1, Number(fromAyah) || 1);
  const to = Math.min(chapter.ayahCount, Math.max(from, Number(toAyah) || from));

  let verses;
  try {
    verses = await createDataSource().getVerses(surah, MALAY_TRANSLATION_ID);
  } catch {
    return { ok: false, error: "Could not reach the Quran service. Try again in a moment." };
  }

  const inRange = verses.filter((v) => {
    const n = Number(String(v.verseKey).split(":")[1]);
    return n >= from && n <= to;
  });

  if (inRange.length === 0) {
    return { ok: false, error: "No ayat found in that range." };
  }

  const tokenLists = inRange.map((v) => parseTajweed(v.textTajweed || ""));
  const rules = rulesPresent(tokenLists).map((key) => ({ key, label: tajweedRule(key).label }));

  return {
    ok: true,
    analysis: {
      surah,
      surahName: chapter.name,
      fromAyah: from,
      toAyah: to,
      label: sabaqLabel(surah, from, to),
      ayahCount: inRange.length,
      rules,
      // Plain Arabic + translation for the pack's reference panel, and as the
      // grounding the model writes against.
      ayat: inRange.map((v) => ({
        key: v.verseKey,
        arabic: v.textUthmani,
        translation: v.translation || "",
      })),
    },
  };
}

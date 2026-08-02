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

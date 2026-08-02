import "server-only";

/**
 * Fetch one ayah word-by-word from Quran.com.
 *
 * Kept separate from lib/quran/data.js on purpose: that module belongs to the
 * Quran reader and is being worked on elsewhere. This is a small, additive
 * read of the same public, keyless API.
 */

const API = "https://api.quran.com/api/v4";
const AUDIO_BASE = "https://audio.qurancdn.com/";

// Abdullah Muhammad Basmeih — the standard Malay mushaf translation.
// Word-level glosses are only published in English, so the ayah translation is
// Malay and the per-word meanings are English. Showing both is the honest
// option, and it is what a mixed-ability teaching team actually needs.
const MALAY_TRANSLATION_ID = 39;

export async function fetchVerseWords(verseKey) {
  const key = String(verseKey || "");
  if (!/^\d{1,3}:\d{1,3}$/.test(key)) return { ok: false, error: "Bad verse reference." };

  const url =
    `${API}/verses/by_key/${key}?words=true` +
    `&word_fields=text_uthmani,transliteration` +
    `&fields=text_uthmani` +
    `&translations=${MALAY_TRANSLATION_ID}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      // The word of the day is the same for everyone and changes once a day,
      // so this is cached for an hour rather than refetched per teacher.
      next: { revalidate: 3600 },
    });
  } catch {
    return { ok: false, error: "Could not reach the Quran service." };
  }
  if (!res.ok) return { ok: false, error: `Quran service returned ${res.status}.` };

  const json = await res.json().catch(() => null);
  const verse = json?.verse;
  if (!verse) return { ok: false, error: "That ayah could not be loaded." };

  // The final "word" of every ayah is the ayah-number glyph, not a word.
  const words = (verse.words || [])
    .filter((w) => w.char_type_name === "word")
    .map((w, i) => ({
      position: i + 1,
      arabic: w.text_uthmani || w.text || "",
      transliteration: w.transliteration?.text || "",
      meaning: stripBrackets(w.translation?.text || ""),
      audio: w.audio_url ? AUDIO_BASE + w.audio_url : null,
    }))
    .filter((w) => w.arabic && w.meaning);

  if (words.length === 0) return { ok: false, error: "No words found for that ayah." };

  return {
    ok: true,
    verse: {
      key,
      arabic: verse.text_uthmani || "",
      translation: stripHtml(verse.translations?.[0]?.text || ""),
      words,
    },
  };
}

/**
 * Word glosses arrive as "(is) Allah" / "the One" — the parentheses mark words
 * implied by Arabic grammar rather than present in the text. Useful when
 * reading, but noise on a flashcard, so they are folded into plain text.
 */
function stripBrackets(text) {
  return String(text).replace(/[()]/g, "").replace(/\s+/g, " ").trim();
}

function stripHtml(text) {
  return String(text)
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

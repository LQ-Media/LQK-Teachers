/**
 * Quran data source — framework-agnostic, no Next/React code.
 *
 * Ported unchanged from the LQK Shopify storefront reader. Primary
 * implementation: Quran.com API v4 (no API key required).
 *
 * Fallback (NOT built yet, by design): AlQuran Cloud (https://alquran.cloud).
 * If Quran.com is ever down, write a createAlQuranCloudDataSource() that
 * returns this same interface shape and swap it inside createDataSource()
 * below — no UI code should need to change.
 *
 * Interface returned by createQuranComDataSource():
 *   getChapters()                        -> [{ id, nameSimple, nameArabic, translatedName, versesCount }]
 *   getJuzs()                            -> [{ number, verseMapping }]   // verseMapping: { "<chapterId>": "from-to" }
 *   getTranslations()                    -> [{ id, name, languageName }]
 *   getReciters()                        -> [{ id, name }]
 *   getVerses(chapterId, translationId)  -> [{ verseKey, number, textUthmani, words, translation, transliteration }]
 *   getAudioUrl(reciterId, verseKey)     -> "https://…" (absolute, playable)
 */

const API_BASE = "https://api.quran.com/api/v4";
const AUDIO_BASE = "https://audio.qurancdn.com/";

// Edition id 131 does NOT exist on this API — do not hardcode it.
export const DEFAULT_TRANSLATION_ID = 20; // Saheeh International (confirmed valid)
export const TRANSLITERATION_ID = 57; // always requested alongside the translation
export const DEFAULT_RECITER_ID = 7; // Mishary Rashid Alafasy

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Quran.com API error ${res.status} for ${path}`);
  }
  return res.json();
}

export function stripHtml(text) {
  if (!text) return "";
  return text
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "") // footnote markers — drop content too
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(text) {
  return String(text || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Transliteration comes from AlQuran Cloud's en.transliteration edition — the
// connected/recited "rumi" style ("Bismillaahir Rahmaanir Raheem") — instead of
// Quran.com's word-by-word literal edition (57), which reads disjointed
// ("Bismi Allahi arrahmani arraheem"). One request returns a whole surah.
const ALQURAN_CLOUD_BASE = "https://api.alquran.cloud/v1";
const TRANSLITERATION_EDITION = "en.transliteration";

async function fetchTransliterationMap(chapterId) {
  try {
    const res = await fetch(`${ALQURAN_CLOUD_BASE}/surah/${chapterId}/${TRANSLITERATION_EDITION}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const ayahs = data && data.data && data.data.ayahs;
    const map = {};
    if (Array.isArray(ayahs)) for (const a of ayahs) map[a.numberInSurah] = a.text;
    return map;
  } catch (err) {
    return {}; // transliteration is best-effort; Arabic + translation still render
  }
}

export function createQuranComDataSource() {
  const cache = new Map();

  async function cached(key, loader) {
    if (!cache.has(key)) {
      cache.set(
        key,
        loader().catch((err) => {
          cache.delete(key); // don't cache failures — "Try again" should retry
          throw err;
        })
      );
    }
    return cache.get(key);
  }

  return {
    getChapters() {
      return cached("chapters", async () => {
        const data = await getJson("/chapters?language=en");
        return data.chapters.map((c) => ({
          id: c.id,
          nameSimple: c.name_simple,
          nameArabic: c.name_arabic,
          translatedName: c.translated_name ? c.translated_name.name : "",
          versesCount: c.verses_count,
        }));
      });
    },

    getJuzs() {
      return cached("juzs", async () => {
        const data = await getJson("/juzs");
        // The API can return duplicate juz records — dedupe by juz_number.
        const byNumber = new Map();
        for (const j of data.juzs) {
          if (!byNumber.has(j.juz_number)) {
            byNumber.set(j.juz_number, { number: j.juz_number, verseMapping: j.verse_mapping || {} });
          }
        }
        return [...byNumber.values()].sort((a, b) => a.number - b.number);
      });
    },

    getTranslations() {
      return cached("translations", async () => {
        const data = await getJson("/resources/translations?language=en");
        return data.translations
          .filter((t) => t.id !== TRANSLITERATION_ID) // transliteration is not a "language" choice
          .map((t) => ({ id: t.id, name: t.name, languageName: titleCase(t.language_name) }))
          .sort((a, b) => a.languageName.localeCompare(b.languageName) || a.name.localeCompare(b.name));
      });
    },

    getReciters() {
      return cached("reciters", async () => {
        const data = await getJson("/resources/recitations?language=en");
        return data.recitations
          .map((r) => ({
            id: r.id,
            name: r.translated_name ? r.translated_name.name : r.reciter_name,
            style: r.style || "",
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      });
    },

    getVerses(chapterId, translationId) {
      const key = `verses:${chapterId}:${translationId}`;
      return cached(key, async () => {
        // Arabic + translation from Quran.com; connected transliteration from
        // AlQuran Cloud (fetched once for the whole surah), merged by ayah number.
        const translitMap = await fetchTransliterationMap(chapterId);
        const verses = [];
        let page = 1;
        // per_page=300 covers every surah in one page (longest is 286 ayahs),
        // but follow pagination anyway so nothing can silently truncate.
        for (;;) {
          const data = await getJson(
            `/verses/by_chapter/${chapterId}?language=en&words=true` +
              `&word_fields=text_uthmani,translation&fields=text_uthmani` +
              `&translations=${translationId}` +
              `&per_page=300&page=${page}`
          );
          for (const v of data.verses) {
            const main = (v.translations || [])[0];
            verses.push({
              verseKey: v.verse_key,
              number: v.verse_number,
              textUthmani: v.text_uthmani,
              // Word-by-word for tap tooltips. char_type_name "end" is the
              // ayah-end marker glyph — keep only real words.
              words: (v.words || [])
                .filter((w) => w.char_type_name === "word")
                .map((w) => ({
                  text: w.text_uthmani,
                  meaning: w.translation && w.translation.text ? w.translation.text : "",
                })),
              translation: main ? stripHtml(main.text) : "",
              transliteration: stripHtml(translitMap[v.verse_number] || ""),
            });
          }
          const next = data.pagination && data.pagination.next_page;
          if (!next) break;
          page = next;
        }
        return verses;
      });
    },

    async getAudioUrl(reciterId, verseKey) {
      const key = `audio:${reciterId}:${verseKey}`;
      return cached(key, async () => {
        const data = await getJson(`/recitations/${reciterId}/by_ayah/${verseKey}`);
        const file = data.audio_files && data.audio_files[0];
        if (!file || !file.url) {
          throw new Error(`No audio for ${verseKey} (reciter ${reciterId})`);
        }
        // URLs are usually relative to the audio CDN, but be tolerant of absolute ones.
        return /^https?:\/\//.test(file.url) ? file.url : AUDIO_BASE + file.url.replace(/^\/+/, "");
      });
    },
  };
}

/** Single entry point the app uses — swap the implementation here for the fallback. */
export function createDataSource() {
  return createQuranComDataSource();
}

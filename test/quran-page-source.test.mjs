// Fetching one mushaf page from the API.
//
// The trap this guards is the transliteration merge. Transliteration comes from
// a different service, one request per SURAH, keyed by ayah number within that
// surah. A page that carries the end of Al-Ikhlas and the start of Al-Falaq has
// two ayah 3s and two ayah 4s, so merging with one surah's map would print
// Al-Ikhlas's Latin line under Al-Falaq's Arabic — wrong text under the Quran,
// and nothing about it looks broken on screen.
//
// Run with `npm test`. No dependencies — the API is stubbed on globalThis.fetch.

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createQuranComDataSource } from "../lib/quran/data.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** One verse as Quran.com returns it. */
function apiVerse(verseKey, { page = 604, juz = 30, words = [] } = {}) {
  const [chapterId, number] = verseKey.split(":").map(Number);
  return {
    verse_key: verseKey,
    verse_number: number,
    chapter_id: chapterId,
    page_number: page,
    juz_number: juz,
    text_uthmani: `arabic ${verseKey}`,
    text_uthmani_tajweed: `<tajweed class=ghunnah>arabic ${verseKey}</tajweed>`,
    words: words.map((w) => ({ char_type_name: "word", text_uthmani: w, translation: { text: `${w}-meaning` } })),
    translations: [{ text: `translation of ${verseKey} <sup foot_note=1>1</sup>` }],
  };
}

/**
 * Stand in for both services. `pages` is keyed by mushaf page number,
 * `latin` by surah → { ayahNumber: text }.
 */
function stubApi({ pages = {}, chapters = {}, latin = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);

    const surat = /equran\.id\/api\/v2\/surat\/(\d+)/.exec(href);
    if (surat) {
      const map = latin[surat[1]] || {};
      return json({
        data: { ayat: Object.entries(map).map(([n, teksLatin]) => ({ nomorAyat: Number(n), teksLatin })) },
      });
    }

    const byPage = /verses\/by_page\/(\d+)/.exec(href);
    if (byPage) return json({ verses: pages[byPage[1]] || [], pagination: { next_page: null } });

    const byChapter = /verses\/by_chapter\/(\d+)/.exec(href);
    if (byChapter) return json({ verses: chapters[byChapter[1]] || [], pagination: { next_page: null } });

    throw new Error(`unstubbed request: ${href}`);
  };
  return calls;
}

function json(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe("getPage", () => {
  test("returns the whole page, across surahs, in order", async () => {
    stubApi({
      pages: {
        604: [apiVerse("112:4"), apiVerse("113:1"), apiVerse("113:2"), apiVerse("114:1")],
      },
    });

    const verses = await createQuranComDataSource().getPage(604, 20);
    assert.deepEqual(
      verses.map((v) => v.verseKey),
      ["112:4", "113:1", "113:2", "114:1"]
    );
  });

  test("each verse carries the surah, page and juz the page view needs", async () => {
    stubApi({ pages: { 3: [apiVerse("2:6", { page: 3, juz: 1 })] } });

    const [verse] = await createQuranComDataSource().getPage(3, 20);
    assert.equal(verse.chapterId, 2);
    assert.equal(verse.page, 3);
    assert.equal(verse.juz, 1);
    assert.equal(verse.number, 6);
  });

  test("transliteration is merged per surah, not across the page", async () => {
    stubApi({
      pages: { 604: [apiVerse("112:3"), apiVerse("113:3")] },
      // As Kemenag publishes it — academic diacritics, which the source
      // converts to the pesantren glyphs the teachers read.
      latin: {
        112: { 3: "lam yalid wa lam yūlad" },
        113: { 3: "wa min syarri gāsiqin iżā waqab" },
      },
    });

    const verses = await createQuranComDataSource().getPage(604, 20);
    // Both are ayah 3. Keyed by number alone, the second would inherit the first.
    assert.equal(verses[0].transliteration, "lam yalid wa lam yûlad");
    assert.equal(verses[1].transliteration, "wa min syarri ghâsiqin idzâ waqab");
  });

  test("one transliteration request per surah on the page, not per verse", async () => {
    const calls = stubApi({
      pages: { 604: [apiVerse("113:1"), apiVerse("113:2"), apiVerse("114:1"), apiVerse("114:2")] },
    });

    await createQuranComDataSource().getPage(604, 20);
    const translit = calls.filter((c) => c.includes("equran.id"));
    assert.equal(translit.length, 2, `expected 2 surah requests, made ${translit.length}`);
  });

  test("a surah's transliteration is reused when it is fetched again", async () => {
    const calls = stubApi({
      pages: { 604: [apiVerse("114:1")], 603: [apiVerse("114:2")] },
    });

    const source = createQuranComDataSource();
    await source.getPage(604, 20);
    await source.getPage(603, 20);
    assert.equal(calls.filter((c) => c.includes("equran.id")).length, 1);
  });

  test("footnote markers are stripped out of the translation", async () => {
    stubApi({ pages: { 1: [apiVerse("1:1")] } });
    const [verse] = await createQuranComDataSource().getPage(1, 20);
    assert.equal(verse.translation, "translation of 1:1");
  });

  test("word-by-word survives, so tap-for-meaning works on a page too", async () => {
    stubApi({ pages: { 1: [apiVerse("1:2", { words: ["ٱلْحَمْدُ", "لِلَّهِ"] })] } });
    const [verse] = await createQuranComDataSource().getPage(1, 20);
    assert.deepEqual(verse.words.map((w) => w.text), ["ٱلْحَمْدُ", "لِلَّهِ"]);
    assert.equal(verse.words[0].meaning, "ٱلْحَمْدُ-meaning");
  });

  test("a failed page is not cached, so Try again really retries", async () => {
    let attempt = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("equran.id")) return json({ data: { ayat: [] } });
      attempt += 1;
      if (attempt === 1) return { ok: false, status: 503, json: async () => ({}) };
      return json({ verses: [apiVerse("1:1")], pagination: { next_page: null } });
    };

    const source = createQuranComDataSource();
    await assert.rejects(() => source.getPage(1, 20));
    const verses = await source.getPage(1, 20);
    assert.equal(verses.length, 1);
  });
});

describe("getVerses", () => {
  test("a surah's verses now report which page each ayah is printed on", async () => {
    // This is what lets a teacher switch to page mode without losing their
    // place — and without the app guessing a page number.
    stubApi({
      chapters: { 2: [apiVerse("2:1", { page: 2, juz: 1 }), apiVerse("2:6", { page: 3, juz: 1 })] },
    });

    const verses = await createQuranComDataSource().getVerses(2, 20);
    assert.deepEqual(verses.map((v) => v.page), [2, 3]);
    assert.deepEqual(verses.map((v) => v.chapterId), [2, 2]);
  });
});

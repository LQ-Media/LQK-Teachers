// The reader's page layout: turning pages, switching layouts, and reciting
// across a page break.
//
// The rules here are about not losing a teacher's place. Switching to page
// mode has to open the page the ayah they were on is actually printed on —
// and when the app cannot know that for certain, it must stay put rather than
// show a page arrived at by arithmetic.
//
// Run with `npm test`. No dependencies — the data source is a stub.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createQuranStore } from "../lib/quran/store.js";

/** A verse as the data source hands it over. */
function v(verseKey, page, juz = 1) {
  const [chapterId, number] = verseKey.split(":").map(Number);
  return { verseKey, chapterId, number, page, juz, textUthmani: `text ${verseKey}`, words: [] };
}

// Al-Fatihah on page 1, Al-Baqarah opening on page 2 and running onto page 3 —
// the real shape of the front of the mushaf, which is what makes it a fair test
// of a page that carries the end of one surah and the start of another.
const SURAHS = {
  1: [v("1:1", 1), v("1:2", 1), v("1:6", 1), v("1:7", 1)],
  2: [v("2:1", 2), v("2:2", 2), v("2:5", 2), v("2:6", 3), v("2:7", 3)],
};
const PAGES = {
  1: SURAHS[1],
  2: SURAHS[2].filter((x) => x.page === 2),
  3: SURAHS[2].filter((x) => x.page === 3),
};

function makeStore({ pages = PAGES, surahs = SURAHS, defaults = {}, onGetPage } = {}) {
  const calls = { pages: [], verses: [] };
  const store = createQuranStore({
    dataSource: {
      getChapters: async () => [
        { id: 1, nameSimple: "Al-Fatihah", nameArabic: "الفاتحة", translatedName: "The Opener", versesCount: 7 },
        { id: 2, nameSimple: "Al-Baqarah", nameArabic: "البقرة", translatedName: "The Cow", versesCount: 286 },
      ],
      getJuzs: async () => [{ number: 1, verseMapping: { 1: "1-7", 2: "1-141" } }],
      getTranslations: async () => [{ id: 20, name: "Saheeh International", languageName: "English" }],
      getReciters: async () => [{ id: 7, name: "Mishary Rashid Alafasy" }],
      getVerses: async (chapterId) => {
        calls.verses.push(Number(chapterId));
        return surahs[chapterId] || [];
      },
      getPage: async (pageNumber) => {
        calls.pages.push(Number(pageNumber));
        onGetPage?.(Number(pageNumber));
        const found = pages[pageNumber];
        if (!found) throw new Error(`no page ${pageNumber}`);
        return found;
      },
      getChapterAudio: async () => ({}),
      getAudioUrl: async () => "",
    },
    bookmarkService: { available: false },
    defaults,
  });
  return { store, calls };
}

/** Let the store's in-flight loads settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("opening the reader", () => {
  test("ayah mode is the default and loads no pages", async () => {
    const { store, calls } = makeStore();
    await store.init();
    assert.equal(store.getState().layout, "ayah");
    assert.deepEqual(calls.pages, []);
  });

  test("a teacher who last read in page mode opens straight into it", async () => {
    const { store } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();
    const s = store.getState();
    assert.equal(s.layout, "page");
    assert.equal(s.pageNumber, 1);
    assert.equal(s.pageStatus, "ready");
    assert.deepEqual(s.pageVerses.map((x) => x.verseKey), ["1:1", "1:2", "1:6", "1:7"]);
  });
});

describe("switching layouts keeps your place", () => {
  test("switching to page mode opens the page the current ayah is printed on", async () => {
    const { store } = makeStore();
    await store.init();
    store.goTo(2, "2:6"); // ayah 6 sits on page 3, not on Al-Baqarah's first page
    await settle();

    store.setLayout("page");
    await settle();
    assert.equal(store.getState().pageNumber, 3);
  });

  test("the page number comes from the API, never from counting", async () => {
    const { store, calls } = makeStore();
    await store.init();
    store.goTo(2);
    await settle();
    store.setLayout("page");
    await settle();
    // Surah 2 opens on page 2 because the data says so.
    assert.deepEqual(calls.pages, [2]);
  });

  test("switching back to ayah mode lands on the first ayah of the page just read", async () => {
    const { store } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();
    store.goToPage(3);
    await settle();

    store.setLayout("ayah");
    await settle();
    const s = store.getState();
    assert.equal(s.layout, "ayah");
    assert.equal(s.chapterId, 2);
    assert.equal(s.focusVerseKey, "2:6", "should scroll to where the page began");
  });

  test("an ayah whose page is not known leaves the open page alone", async () => {
    // An offline copy saved before page numbers were requested.
    const noPages = { 1: SURAHS[1].map(({ page, ...rest }) => rest) };
    const { store } = makeStore({ surahs: noPages, defaults: { layout: "page" } });
    await store.init();
    await settle();
    store.goToPage(2);
    await settle();

    store.setLayout("ayah");
    store.setLayout("page"); // nothing authoritative to resolve
    await settle();
    const s = store.getState();
    assert.equal(s.pageNumber, 2, "must not guess a page number");
    assert.equal(s.pageStatus, "ready");
  });

  test("setting the layout it is already on does nothing", async () => {
    const { store, calls } = makeStore();
    await store.init();
    const before = calls.pages.length;
    store.setLayout("ayah");
    await settle();
    assert.equal(calls.pages.length, before);
  });

  test("an unknown layout is ignored", async () => {
    const { store } = makeStore();
    await store.init();
    store.setLayout("scroll");
    assert.equal(store.getState().layout, "ayah");
  });
});

describe("turning pages", () => {
  test("next and previous move one page at a time", async () => {
    const { store } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();

    store.nextPage();
    await settle();
    assert.equal(store.getState().pageNumber, 2);

    store.prevPage();
    await settle();
    assert.equal(store.getState().pageNumber, 1);
  });

  test("the mushaf has no page 0 and no page 605", async () => {
    const { store, calls } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();
    const before = calls.pages.length;

    store.prevPage(); // already on page 1
    await settle();
    assert.equal(store.getState().pageNumber, 1);
    assert.equal(calls.pages.length, before, "should not have re-fetched");

    store.goToPage(9999);
    await settle();
    assert.equal(store.getState().pageNumber, 604);
  });

  test("a page that fails to load says so and can be retried", async () => {
    const { store } = makeStore({ pages: { 1: PAGES[1] }, defaults: { layout: "page" } });
    await store.init();
    await settle();

    store.goToPage(2); // not in the stub — throws
    await settle();
    assert.equal(store.getState().pageStatus, "error");

    store.goToPage(1);
    await settle();
    assert.equal(store.getState().pageStatus, "ready");
  });

  test("turning the page twice quickly lands on the last one asked for", async () => {
    const { store } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();

    store.goToPage(2);
    store.goToPage(3); // before page 2 resolves
    await settle();
    const s = store.getState();
    assert.equal(s.pageNumber, 3);
    assert.deepEqual(s.pageVerses.map((x) => x.verseKey), ["2:6", "2:7"]);
  });

  test("the surah shown follows the page, so the header names what is on screen", async () => {
    const { store } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();
    assert.equal(store.getState().chapterId, 1);

    store.goToPage(3);
    await settle();
    assert.equal(store.getState().chapterId, 2);
  });
});

describe("jumping to a surah while in page mode", () => {
  test("the surah dropdown turns to that surah's page", async () => {
    const { store } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();

    store.goTo(2);
    await settle();
    assert.equal(store.getState().pageNumber, 2);
  });

  test("jumping to a specific ayah turns to that ayah's page", async () => {
    const { store } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();

    store.goTo(2, "2:7");
    await settle();
    assert.equal(store.getState().pageNumber, 3);
  });
});

describe("prev / next ayah", () => {
  test("step through the page on screen, not the whole surah", async () => {
    // Page 3 holds only 2:6 and 2:7. Stepping back from 2:6 must stop at the
    // top of the page rather than walking into ayahs that are not shown.
    const { store } = makeStore({ defaults: { layout: "page" } });
    await store.init();
    await settle();
    store.goToPage(3);
    await settle();

    assert.deepEqual(
      store.getState().pageVerses.map((x) => x.verseKey),
      ["2:6", "2:7"]
    );
  });
});

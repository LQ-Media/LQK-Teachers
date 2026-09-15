// Mushaf page layout — what gets drawn on a page of the Quran reader.
//
// The rules these protect are typographic conventions of the printed mushaf,
// and breaking one is the kind of error a teacher notices immediately and
// trusts the app less for: a basmalah printed above Al-Fatihah (where it is
// already ayah 1), a heading over At-Tawbah (which has no basmalah), or a
// heading over a surah that merely continues from the previous page.
//
// Run with `npm test`. No dependencies — Node's built-in runner.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PAGE_COUNT,
  arabicDigits,
  ayahOfVerse,
  buildPageBlocks,
  chapterOfVerse,
  chaptersOnPage,
  clampPage,
  firstVerseOfPage,
  juzOfPage,
  pageOfVerse,
} from "../lib/quran/pages.js";

/** Shorthand for a verse as the data source hands it over. */
function v(verseKey, extra = {}) {
  const [chapterId, number] = verseKey.split(":").map(Number);
  return { verseKey, chapterId, number, textUthmani: `text ${verseKey}`, ...extra };
}

describe("page numbers", () => {
  test("the Madani mushaf has 604 pages", () => {
    assert.equal(PAGE_COUNT, 604);
  });

  test("a page number is held inside the mushaf", () => {
    assert.equal(clampPage(0), 1);
    assert.equal(clampPage(-5), 1);
    assert.equal(clampPage(605), 604);
    assert.equal(clampPage(604), 604);
  });

  test("nonsense falls back to the first page rather than a blank reader", () => {
    assert.equal(clampPage("abc"), 1);
    assert.equal(clampPage(null), 1);
    assert.equal(clampPage(undefined), 1);
    assert.equal(clampPage(12.6), 13);
  });
});

describe("reading a verse key", () => {
  test("surah and ayah come out as numbers", () => {
    assert.equal(chapterOfVerse("2:255"), 2);
    assert.equal(ayahOfVerse("2:255"), 255);
    assert.equal(chapterOfVerse("114:6"), 114);
  });
});

describe("laying out a page", () => {
  test("a page inside one surah is a single run with no heading", () => {
    // Page 3 is entirely Al-Baqarah — it neither starts nor ends a surah.
    const blocks = buildPageBlocks([v("2:6"), v("2:7"), v("2:8")]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "verses");
    assert.equal(blocks[0].chapterId, 2);
    assert.equal(blocks[0].verses.length, 3);
  });

  test("a surah that begins on the page gets a heading and a basmalah", () => {
    // The end of Al-Fatihah followed by the opening of Al-Baqarah.
    const blocks = buildPageBlocks([v("1:7"), v("2:1"), v("2:2")]);
    assert.deepEqual(
      blocks.map((b) => [b.type, b.chapterId]),
      [
        ["verses", 1],
        ["heading", 2],
        ["verses", 2],
      ]
    );
    assert.equal(blocks[1].bismillah, true);
  });

  test("Al-Fatihah gets no printed basmalah — it is already ayah 1", () => {
    const [heading] = buildPageBlocks([v("1:1"), v("1:2")]);
    assert.equal(heading.type, "heading");
    assert.equal(heading.chapterId, 1);
    assert.equal(heading.bismillah, false, "would print the basmalah twice");
  });

  test("At-Tawbah gets a heading but never a basmalah", () => {
    const [heading] = buildPageBlocks([v("9:1")]);
    assert.equal(heading.chapterId, 9);
    assert.equal(heading.bismillah, false);
  });

  test("a surah continuing from the previous page gets no heading", () => {
    // Page 50 opens mid-Al-Baqarah. Printing "Surah Al-Baqarah" again here
    // would tell a teacher the surah restarts.
    const blocks = buildPageBlocks([v("2:253"), v("2:254")]);
    assert.equal(blocks.filter((b) => b.type === "heading").length, 0);
  });

  test("the short surahs at the back stack several headings on one page", () => {
    // Page 604: the end of Al-Ikhlas, then Al-Falaq and An-Nas in full.
    const blocks = buildPageBlocks([
      v("112:3"), v("112:4"),
      v("113:1"), v("113:2"),
      v("114:1"), v("114:2"),
    ]);
    assert.deepEqual(
      blocks.map((b) => `${b.type}:${b.chapterId}`),
      ["verses:112", "heading:113", "verses:113", "heading:114", "verses:114"]
    );
    assert.ok(blocks.every((b) => b.type !== "heading" || b.bismillah));
  });

  test("every verse handed in is drawn exactly once, in order", () => {
    const input = [v("112:4"), v("113:1"), v("113:2"), v("114:1")];
    const drawn = buildPageBlocks(input)
      .filter((b) => b.type === "verses")
      .flatMap((b) => b.verses.map((x) => x.verseKey));
    assert.deepEqual(drawn, input.map((x) => x.verseKey), "a verse was dropped or repeated");
  });

  test("a verse with only a key still lands in the right run", () => {
    // Offline copies saved before chapterId was carried per verse.
    const blocks = buildPageBlocks([{ verseKey: "113:1", number: 1 }]);
    assert.equal(blocks[0].type, "heading");
    assert.equal(blocks[0].chapterId, 113);
  });

  test("an empty page draws nothing rather than throwing", () => {
    assert.deepEqual(buildPageBlocks([]), []);
    assert.deepEqual(buildPageBlocks(null), []);
  });
});

describe("the page header", () => {
  test("names each surah on the page, in reading order", () => {
    assert.deepEqual(chaptersOnPage([v("1:7"), v("2:1"), v("2:2")]), [1, 2]);
    assert.deepEqual(chaptersOnPage([v("2:6"), v("2:7")]), [2]);
    assert.deepEqual(chaptersOnPage([]), []);
  });

  test("shows the juz the page opens in", () => {
    // Page 21 opens in juz 1 and crosses into juz 2; print says juz 1.
    assert.equal(juzOfPage([v("2:140", { juz: 1 }), v("2:142", { juz: 2 })]), 1);
    assert.equal(juzOfPage([v("2:6")]), null, "no juz known — show nothing, not zero");
  });
});

describe("keeping your place across the two layouts", () => {
  test("an ayah reports the page it is printed on", () => {
    const verses = [v("2:1", { page: 2 }), v("2:5", { page: 2 }), v("2:6", { page: 3 })];
    assert.equal(pageOfVerse(verses, "2:6"), 3);
  });

  test("an unknown ayah, or one saved without a page, answers null", () => {
    // null means "ask the API", never a guessed page number.
    const verses = [v("2:1", { page: 2 }), v("2:2")];
    assert.equal(pageOfVerse(verses, "2:2"), null);
    assert.equal(pageOfVerse(verses, "9:1"), null);
    assert.equal(pageOfVerse([], "2:1"), null);
  });

  test("switching back to ayah view lands on the page's first ayah", () => {
    assert.equal(firstVerseOfPage([v("2:6"), v("2:7")]), "2:6");
    assert.equal(firstVerseOfPage([]), null);
  });
});

describe("Arabic-Indic digits", () => {
  test("ayah markers and page numbers are printed in Arabic numerals", () => {
    assert.equal(arabicDigits(1), "١");
    assert.equal(arabicDigits(255), "٢٥٥");
    assert.equal(arabicDigits(604), "٦٠٤");
  });
});

// Guest-facing copy (lib/events/i18n.js).
//
// The property worth testing is PARITY: every language defines every key, so
// no guest can ever see a silent English fallback (or worse, a raw key name)
// because a translator missed one string. Plus the handful of behavioural
// rules the Aug 2026 copy audit pinned down.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  LANGS,
  DECLINE_REASONS,
  allStringTables,
  t,
  fmt,
  declineReasonLabel,
  partyLine,
  isDeclineReason,
} from "../lib/events/i18n.js";

describe("string tables", () => {
  const tables = allStringTables();
  const langs = LANGS.map((l) => l.code);

  test("every language defines exactly the same keys", () => {
    const [first, ...rest] = langs;
    const reference = Object.keys(tables[first]).sort();
    for (const lang of rest) {
      assert.deepEqual(
        Object.keys(tables[lang]).sort(),
        reference,
        `key set for "${lang}" differs from "${first}"`
      );
    }
  });

  test("every decline reason has a label in every language", () => {
    for (const lang of langs) {
      for (const key of DECLINE_REASONS) {
        const label = tables[lang][`reason_${key}`];
        assert.ok(label && label.length > 3, `reason_${key} missing for ${lang}`);
      }
    }
  });

  test("no string still says RSVP, forwards a link, or asks 'maybe'", () => {
    for (const lang of langs) {
      for (const [key, value] of Object.entries(tables[lang])) {
        assert.ok(!/\bRSVP\b/i.test(value), `${lang}.${key} says "RSVP"`);
        assert.ok(!/forward/i.test(value), `${lang}.${key} says "forward"`);
      }
      assert.equal(tables[lang].maybe, undefined, `${lang} still has a 'maybe' key`);
      assert.equal(tables[lang].dietary, undefined, `${lang} still has a 'dietary' key`);
    }
  });

  test("acceptance says Alhamdulillah in every language — الحمد لله in Arabic", () => {
    assert.match(tables.en.thanksYes, /Alhamdulillah/);
    assert.match(tables.ms.thanksYes, /Alhamdulillah/);
    assert.match(tables.ar.thanksYes, /الحمد لله/);
    assert.doesNotMatch(tables.ar.thanksYes, /ما شاء الله/);
  });

  test("the photo-size error no longer quotes a limit nothing enforces", () => {
    for (const lang of ["en", "ms", "ar"]) {
      assert.ok(!/10\s?MB|١٠/.test(tables[lang].tooLarge), `${lang}.tooLarge quotes a number`);
    }
  });
});

describe("helpers", () => {
  test("t() falls back to English for a missing language, key for a missing key", () => {
    assert.equal(t("xx")("submit"), "Send my reply");
    assert.equal(t("en")("no_such_key"), "no_such_key");
  });

  test("fmt fills variables and never prints braces for missing ones", () => {
    assert.equal(fmt("Reply by {date}.", { date: "1 Sept" }), "Reply by 1 Sept.");
    assert.equal(fmt("Reply by {date}.", {}), "Reply by .");
  });

  test("declineReasonLabel resolves stored keys", () => {
    assert.ok(isDeclineReason("away"));
    assert.ok(!isDeclineReason("attending"));
    assert.match(declineReasonLabel("en", "away"), /travelling/);
    assert.match(declineReasonLabel("ms", "work"), /kerja/i);
  });

  test("partyLine handles singulars and skips zeros", () => {
    assert.equal(partyLine("en", 2, 3), "2 adults, 3 children");
    assert.equal(partyLine("en", 1, 1), "1 adult, 1 child");
    assert.equal(partyLine("en", 2, 0), "2 adults");
  });
});

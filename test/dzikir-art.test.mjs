// The devotional library's group tiles.
//
// lib/dzikir/icons.js is HAND-maintained, but lib/dzikir/catalog.js is
// generated (by baalwi-import/work/gen_portal.py). So a new group arriving
// from the import pipeline does not add itself to GROUP_IMAGES, and a group
// listed there does not conjure a PNG. Either mismatch is invisible until a
// tile 404s on a real device — which is exactly the sort of thing nobody
// notices in a diff of 33 regenerated section files.
//
// These tests pin the three-way invariant: every group in the catalog has an
// entry in icons.js, and every entry has a real file on disk.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { CATALOG } from "../lib/dzikir/catalog.js";
import { groupImage } from "../lib/dzikir/icons.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "public", "dzikir");
// CATALOG is an array of GROUPS, each holding its own `sections` — not a flat
// section list. Getting that wrong is easy and silently yields no groups, so
// the first test below asserts we found some.
const groups = [...new Set(CATALOG.map((g) => g.key))].sort();

describe("dzikir group art", () => {
  test("the catalog actually has groups", () => {
    assert.ok(groups.length >= 5, `expected several groups, got ${groups.length}`);
  });

  for (const g of groups) {
    test(`group "${g}" has a tile image mapped and on disk`, () => {
      const src = groupImage(g);
      assert.ok(src, `lib/dzikir/icons.js has no GROUP_IMAGES entry for "${g}" — add it, or the group heading renders without art`);
      assert.equal(src, `/dzikir/${g}.png`);
      assert.ok(
        existsSync(path.join(ROOT, "public", "dzikir", `${g}.png`)),
        `public/dzikir/${g}.png is missing — regenerate it with GEMINI_API_KEY=... node scripts/generate-art.mjs dzikir/${g}`
      );
    });
  }

  test("every mapped tile is a 512x512 PNG with an alpha channel", () => {
    // Cheap header read rather than pulling in an image library: bytes 16-24 of
    // the IHDR are width/height, byte 25 is the colour type (6 = RGBA).
    // The art pipeline keys transparency out of a white ground (scripts/art/
    // matte.mjs) precisely because the model cannot emit alpha, so a file that
    // came back as plain RGB means the matte step was skipped and the tile will
    // show as a white box against the heading colour.
    for (const g of groups) {
      const buf = readFileSync(path.join(ROOT, "public", "dzikir", `${g}.png`));
      assert.equal(buf.toString("ascii", 1, 4), "PNG", `${g}.png is not a PNG`);
      assert.equal(buf.readUInt32BE(16), 512, `${g}.png is not 512 wide`);
      assert.equal(buf.readUInt32BE(20), 512, `${g}.png is not 512 tall`);
      assert.equal(buf[25], 6, `${g}.png has no alpha channel — it was not matted`);
    }
  });

  test("no orphaned art in public/dzikir", () => {
    // A PNG with no group behind it is dead weight rather than a bug, but it
    // means the set has drifted from the catalog — which is how the missing
    // tile case sneaks back in from the other direction.
    const known = new Set(groups);
    const orphans = readdirSync(ART)
      .filter((f) => f.endsWith(".png"))
      .map((f) => f.slice(0, -4))
      .filter((slug) => !known.has(slug));
    assert.deepEqual(orphans, [], `public/dzikir has art for no catalog group: ${orphans.join(", ")}`);
  });
});

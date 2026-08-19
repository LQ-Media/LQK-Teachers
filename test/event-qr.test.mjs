// The QR encoder (lib/events/qr.js).
//
// This is hand-written rather than a dependency, which means nothing else in
// the world checks it. A QR that encodes almost-the-right-thing still scans —
// it just sends the family somewhere useless — so the only test worth having
// is a ROUND TRIP through an independent decoder. jsQR is already in the tree
// for the booth scanner's Safari fallback, and it shares no code with the
// encoder, so agreement between the two means the symbol is genuinely valid.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import jsQR from "jsqr";

import { qrMatrix, qrSvg } from "../lib/events/qr.js";

/* Render the matrix to the RGBA buffer jsQR expects, with the 4-module quiet
   zone the spec requires — without it a decoder cannot find the finders. */
function decode(text, scale = 4) {
  const { size, modules } = qrMatrix(text);
  const quiet = 4;
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = (((r + quiet) * scale + y) * dim + ((c + quiet) * scale + x)) * 4;
          data[px] = data[px + 1] = data[px + 2] = 0;
        }
      }
    }
  }
  const result = jsQR(data, dim, dim);
  return result ? result.data : null;
}

describe("qrMatrix", () => {
  test("a pass URL round-trips through an independent decoder", () => {
    const url = "https://teachers.littlequrankids.sg/q/p/K7M2XQ9B";
    assert.equal(decode(url), url);
  });

  test("the sizes either end of the range both round-trip", () => {
    // One character (version 1) and 200 bytes (version 9/10) exercise the two
    // ends of the block table, the character-count widening, and the version
    // information strip that only exists from version 7 up.
    assert.equal(decode("A"), "A");
    const long = `https://teachers.littlequrankids.sg/q/${"x".repeat(160)}`;
    assert.equal(decode(long), long);
  });

  test("every symbol is square, odd-sized, and grows by 4 per version", () => {
    for (const text of ["A", "https://teachers.littlequrankids.sg/q/p/K7M2XQ9B"]) {
      const { size, modules, version } = qrMatrix(text);
      assert.equal(size, version * 4 + 17);
      assert.equal(modules.length, size);
      for (const row of modules) assert.equal(row.length, size);
    }
  });

  test("the three finder patterns are in their corners", () => {
    // If these are wrong nothing decodes at all, and the failure looks like a
    // camera problem rather than an encoder problem.
    const { size, modules } = qrMatrix("https://example.com");
    for (const [row, col] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      assert.equal(modules[row][col], true, "finder corner");
      assert.equal(modules[row + 1][col + 1], false, "the white ring");
      assert.equal(modules[row + 3][col + 3], true, "the dark core");
    }
  });

  test("UTF-8 text survives, since a family's own words can reach a QR", () => {
    const text = "Little Qurʼan Kids — Maulid ﷺ";
    assert.equal(decode(text), text);
  });

  test("over-long input throws rather than silently encoding half a URL", () => {
    // A truncated URL still scans perfectly and goes nowhere — the worst
    // possible failure, because it looks like it worked.
    assert.throws(() => qrMatrix("x".repeat(400)), /exceeds/);
  });
});

describe("qrSvg", () => {
  test("emits a viewBox with the quiet zone and a non-empty path", () => {
    const { viewBox, path, size } = qrSvg("https://teachers.littlequrankids.sg/q/p/K7M2XQ9B");
    const { size: modules } = qrMatrix("https://teachers.littlequrankids.sg/q/p/K7M2XQ9B");
    assert.equal(size, modules + 8, "4 modules of quiet zone each side");
    assert.equal(viewBox, `0 0 ${size} ${size}`);
    assert.match(path, /^M\d+ \d+h\d+v1h-\d+z/);
  });
});

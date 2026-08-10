// The invitation design spec (lib/events/theme.js).
//
// This module is the security and accessibility boundary for AI-generated
// invitation designs: Gemini emits a spec, sanitizeTheme clamps it, and the
// result is rendered to guests without further review. So the properties worth
// testing are not "does it parse" but "can a hostile or merely incompetent
// generation get something unreadable or off-origin in front of 200 people".

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  LAYOUTS,
  ORNAMENTS,
  MOTIONS,
  FONT_PAIRS,
  DEFAULT_THEME,
  sanitizeTheme,
  contrastRatio,
  themeVars,
} from "../lib/events/theme.js";

describe("sanitizeTheme always returns something renderable", () => {
  test("garbage in, house theme out", () => {
    for (const input of [null, undefined, "", "not json", 42, [], { palette: "red" }]) {
      const t = sanitizeTheme(input);
      assert.ok(LAYOUTS.includes(t.layout));
      assert.ok(ORNAMENTS.includes(t.ornament));
      assert.ok(MOTIONS.includes(t.motion));
      assert.ok(Object.keys(FONT_PAIRS).includes(t.fontPair));
    }
  });

  test("a JSON string is accepted, since that is how it comes out of the DB", () => {
    const t = sanitizeTheme(JSON.stringify({ ...DEFAULT_THEME, layout: "arch-window" }));
    assert.equal(t.layout, "arch-window");
  });

  test("unknown enum values fall back rather than reaching the renderer", () => {
    const t = sanitizeTheme({ layout: "spinning-cube", ornament: "<svg>", motion: "explode" });
    assert.equal(t.layout, DEFAULT_THEME.layout);
    assert.equal(t.ornament, DEFAULT_THEME.ornament);
    assert.equal(t.motion, DEFAULT_THEME.motion);
  });

  test("numbers are clamped, so no generation can blow up the type scale", () => {
    const t = sanitizeTheme({ scale: 99, radius: -50, ornamentOpacity: 5, bgImageOpacity: 9 });
    assert.ok(t.scale <= 1.25 && t.scale >= 0.85);
    assert.ok(t.radius >= 0 && t.radius <= 32);
    assert.ok(t.ornamentOpacity <= 0.4);
    assert.ok(t.bgImageOpacity <= 0.6);
  });
});

describe("bgImage cannot point off-origin", () => {
  test("same-origin paths and data URIs are kept", () => {
    assert.equal(sanitizeTheme({ bgImage: "/api/events/art/x.webp" }).bgImage, "/api/events/art/x.webp");
    assert.equal(sanitizeTheme({ bgImage: "data:image/png;base64,AAA" }).bgImage, "data:image/png;base64,AAA");
  });

  test("anything that would phone out from a guest's browser is dropped", () => {
    for (const bad of [
      "https://evil.example/track.png",
      // Protocol-relative: passes a naive startsWith("/") check and then
      // resolves to a third-party host. This one was live until 10 Aug 2026.
      "//evil.example/track.png",
      "/\\evil.example/track.png",
      "javascript:alert(1)",
      "data:text/html,<script>",
      12345,
    ]) {
      assert.equal(sanitizeTheme({ bgImage: bad }).bgImage, null, `should reject ${bad}`);
    }
  });
});

describe("contrast is enforced, not merely hoped for", () => {
  test("body text reaches 7:1 on the card even when the model picks cream on cream", () => {
    const t = sanitizeTheme({ palette: { surface: "#FFFDF8", ink: "#F5EFE0", muted: "#FAF6EC", accent: "#FFF8E0" } });
    assert.ok(contrastRatio(t.palette.ink, t.palette.surface) >= 7);
    assert.ok(contrastRatio(t.palette.muted, t.palette.surface) >= 4.5);
    assert.ok(contrastRatio(t.palette.accent, t.palette.surface) >= 4.5);
  });

  test("it also works the other way — dark text asked for on a dark card", () => {
    const t = sanitizeTheme({ palette: { surface: "#101014", ink: "#15151A", muted: "#1A1A20" } });
    assert.ok(contrastRatio(t.palette.ink, t.palette.surface) >= 7);
  });

  /* The regression this file exists for.

     The palette guarantees contrast against `surface` (the card). The language
     switcher and the footer sit on `bg` (the page). While every theme was a
     cream page behind a near-white card those were interchangeable — the moment
     a generated theme picked a dark green page behind a light card, `muted`
     landed at 1.6:1 on the page and the language switcher vanished. --inv-on-bg
     is derived specifically for that, so it must hold for ANY bg the sanitizer
     will accept, not just the one that exposed it. */
  test("--inv-on-bg is legible on the page, however dark or light it is", () => {
    const pages = ["#163323", "#FBF6EC", "#000000", "#FFFFFF", "#7A6A55", "#2B1A3D"];
    for (const bg of pages) {
      const vars = themeVars({ palette: { bg, surface: "#FDFBFA", ink: "#0F281B" } });
      assert.ok(
        contrastRatio(vars["--inv-on-bg"], bg) >= 4.5,
        `--inv-on-bg ${vars["--inv-on-bg"]} only reaches ${contrastRatio(vars["--inv-on-bg"], bg).toFixed(2)}:1 on ${bg}`
      );
    }
  });

  test("every layout the model may choose is one the renderer draws", () => {
    // LAYOUTS is sent to Gemini as an enum and used as a CSS attribute value;
    // a name here with no rule in invitation.css renders as centred-classic
    // silently, which is the kind of bug that only shows up in someone's inbox.
    assert.deepEqual(
      [...LAYOUTS].sort(),
      [
        "arch-window",
        "centered-classic",
        "framed-panel",
        "minimal-rule",
        "photo-hero",
        "side-band",
      ]
    );
  });
});

describe("themeVars", () => {
  test("emits every custom property the stylesheet reads", () => {
    const vars = themeVars(DEFAULT_THEME);
    for (const key of [
      "--inv-bg",
      "--inv-on-bg",
      "--inv-surface",
      "--inv-ink",
      "--inv-muted",
      "--inv-accent",
      "--inv-line",
      "--inv-radius",
      "--inv-scale",
      "--inv-font-heading",
      "--inv-font-body",
      "--inv-ornament-opacity",
      "--inv-bg-image-opacity",
    ]) {
      assert.ok(vars[key] !== undefined, `missing ${key}`);
    }
  });

  test("survives a null theme, because the guest page falls back to it", () => {
    assert.equal(themeVars(null)["--inv-bg"], DEFAULT_THEME.palette.bg);
  });
});

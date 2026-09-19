import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  LEVELS, levelFor, scaleFor, cumulative, nearestWithin, advance, fraction, isComplete, hintAt,
} from "../lib/games/trace.js";
import { syllables, WORD_CARDS, allWords } from "../lib/games/words.js";
import { HURUF, HARAKAT, huruf, withHarakah, sayFor, audioKey } from "../lib/games/huruf.js";

// A straight 400-long horizontal stroke, the simplest thing to reason about.
// Mind the offset when reading these tests: progress is a DISTANCE along the
// stroke, not an x coordinate, and the stroke starts at x=100. Distance 200 is
// the point x=300, so a pointer at x=260 is *behind* a progress of 200.
const LINE = [[100, 500], [300, 500], [500, 500]];
const LINE_CUMS = cumulative(LINE);

test("cumulative measures the polyline", () => {
  assert.deepEqual(LINE_CUMS, [0, 200, 400]);
  assert.deepEqual(cumulative([[0, 0]]), [0]);
});

test("cumulative handles a diagonal", () => {
  assert.deepEqual(cumulative([[0, 0], [3, 4]]), [0, 5]);
});

test("nearestWithin only looks inside the window", () => {
  // Directly above the 200 mark, 10 away.
  assert.equal(nearestWithin(LINE, LINE_CUMS, [300, 490], 0, 400).at, 200);
  // The same point is invisible when the window stops short of it.
  assert.equal(nearestWithin(LINE, LINE_CUMS, [300, 490], 0, 100), null);
  // ...and when the window starts past it.
  assert.equal(nearestWithin(LINE, LINE_CUMS, [300, 490], 300, 400), null);
});

test("nearestWithin finds a foot inside a straddling segment", () => {
  // The window 150..190 lies wholly inside the first segment, so neither of
  // that segment's endpoints (0 and 200) is in the window. The projection still
  // has to be found, or a finger mid-segment would read as off the path.
  const hit = nearestWithin(LINE, LINE_CUMS, [270, 512], 150, 190);
  assert.ok(hit, "a foot inside a straddling segment must be found");
  assert.equal(hit.at, 170);
  assert.equal(hit.dist, 12);
});

test("nearestWithin prefers the nearer of two candidate segments", () => {
  // x=310 is 10 past the joint, so the second segment is the nearer one.
  assert.equal(nearestWithin(LINE, LINE_CUMS, [310, 500], 0, 400).at, 210);
});

test("a finger on the path advances the glow", () => {
  const r = advance({
    points: LINE, cums: LINE_CUMS, pointer: [180, 505],
    progress: 0, level: LEVELS.easy, started: true,
  });
  assert.equal(r.state, "advanced");
  assert.equal(Math.round(r.progress), 80);
});

test("a finger off the path earns nothing", () => {
  const r = advance({
    points: LINE, cums: LINE_CUMS, pointer: [180, 700],
    progress: 0, level: LEVELS.easy, started: true,
  });
  assert.equal(r.state, "off");
  assert.equal(r.progress, 0);
});

test("progress cannot be skipped ahead", () => {
  // Touching the far end while barely started is outside the look-ahead window.
  const r = advance({
    points: LINE, cums: LINE_CUMS, pointer: [500, 500],
    progress: 10, level: LEVELS.proper, started: true,
  });
  assert.equal(r.state, "off");
  assert.equal(r.progress, 10);
});

test("scribbling backwards does not undo or add progress", () => {
  const r = advance({
    points: LINE, cums: LINE_CUMS, pointer: [150, 500],
    progress: 300, level: LEVELS.proper, started: true,
  });
  assert.equal(r.state, "off"); // 50 is behind the window in proper mode
  assert.equal(r.progress, 300);
});

test("both levels tolerate a finger resting just behind the glow", () => {
  // x=250 is distance 150, fifty behind a progress of 200. Easy mode's window
  // opens 105 behind so the foot itself is inside it. Proper mode's window
  // opens at 200, but the projection clamps to that boundary point (x=300),
  // which is still within proper's 62 tolerance — so neither level tells a
  // child who is a hair behind that they have wandered off the letter.
  const slip = { points: LINE, cums: LINE_CUMS, pointer: [250, 500], progress: 200, started: true };
  assert.equal(advance({ ...slip, level: LEVELS.easy }).state, "held");
  assert.equal(advance({ ...slip, level: LEVELS.proper }).state, "held");
});

test("easy mode reaches further back than proper mode", () => {
  // x=200 is distance 100, a full hundred behind. Easy still finds it; proper's
  // clamped boundary point is now 100 away, outside its 62 tolerance.
  const back = { points: LINE, cums: LINE_CUMS, pointer: [200, 500], progress: 200, started: true };
  assert.equal(advance({ ...back, level: LEVELS.easy }).state, "held");
  assert.equal(advance({ ...back, level: LEVELS.proper }).state, "off");
});

test("ahead of the glow, both levels advance it", () => {
  const ahead = { points: LINE, cums: LINE_CUMS, pointer: [360, 500], progress: 200, started: true };
  assert.equal(advance({ ...ahead, level: LEVELS.easy }).progress, 260);
  assert.equal(advance({ ...ahead, level: LEVELS.proper }).progress, 260);
});

test("proper mode insists the stroke starts at its beginning", () => {
  const mid = advance({
    points: LINE, cums: LINE_CUMS, pointer: [300, 500],
    progress: 0, level: LEVELS.proper, started: false,
  });
  assert.equal(mid.state, "wrongStart");

  const atStart = advance({
    points: LINE, cums: LINE_CUMS, pointer: [105, 500],
    progress: 0, level: LEVELS.proper, started: false,
  });
  assert.equal(atStart.state, "advanced");
});

test("easy mode lets a stroke be picked up anywhere near it", () => {
  const r = advance({
    points: LINE, cums: LINE_CUMS, pointer: [300, 500],
    progress: 0, level: LEVELS.easy, started: false,
  });
  assert.equal(r.state, "advanced");
});

test("holding still is distinguished from straying", () => {
  // On the path but no further along: the glow should hold, not reset, and the
  // game must not mistake a resting finger for a child who has wandered off.
  const held = advance({
    points: LINE, cums: LINE_CUMS, pointer: [290, 500],
    progress: 200, level: LEVELS.easy, started: true,
  });
  assert.equal(held.state, "held");
  assert.equal(held.progress, 200);

  const strayed = advance({
    points: LINE, cums: LINE_CUMS, pointer: [290, 800],
    progress: 200, level: LEVELS.easy, started: true,
  });
  assert.equal(strayed.state, "off");
  assert.equal(strayed.progress, 200);
});

test("completion does not demand the very last pixel", () => {
  assert.equal(fraction(0, 400), 0);
  assert.equal(fraction(400, 400), 1);
  assert.equal(fraction(10, 0), 0);
  assert.ok(isComplete(355, 400, LEVELS.easy));      // 0.8875 ≥ 0.88
  assert.ok(!isComplete(340, 400, LEVELS.easy));
  assert.ok(!isComplete(355, 400, LEVELS.proper));   // proper wants 0.94
  assert.ok(isComplete(380, 400, LEVELS.proper));
});

test("levelFor falls back to easy for an unknown name", () => {
  assert.equal(levelFor("proper"), LEVELS.proper);
  assert.equal(levelFor("nonsense"), LEVELS.easy);
  assert.equal(levelFor(undefined), LEVELS.easy);
});

test("the direction hint sits ahead of the finger, along the path", () => {
  const h = hintAt(LINE, LINE_CUMS, 100, 50);
  assert.equal(h.x, 250);
  assert.equal(h.y, 500);
  assert.equal(h.angle, 0);
  // Past the end it clamps to the last point rather than running off.
  assert.deepEqual(
    { x: hintAt(LINE, LINE_CUMS, 400, 90).x, y: hintAt(LINE, LINE_CUMS, 400, 90).y },
    { x: 500, y: 500 },
  );
});

test("the hint angles with a turning path", () => {
  const bend = [[0, 0], [100, 0], [100, 100]];
  const h = hintAt(bend, cumulative(bend), 120, 30);
  assert.equal(h.angle, 90);
});

/* ---------------------------------------------------------------- deck data */

test("all 28 huruf are present, in deck order", () => {
  assert.equal(HURUF.length, 28);
  assert.equal(HURUF[0].id, "alif");
  assert.equal(HURUF[27].id, "ya");
  assert.equal(new Set(HURUF.map((h) => h.id)).size, 28);
  assert.equal(new Set(HURUF.map((h) => h.char)).size, 28);
});

test("every letter has three positional forms and three harakat labels", () => {
  for (const h of HURUF) {
    assert.equal(h.forms.length, 3, h.id);
    assert.equal(h.say.length, 3, h.id);
    assert.ok(h.name.length > 0, h.id);
  }
});

test("the deck's tafkhim transliterations survive", () => {
  // These are the eight letters the deck gives an "o" on fatha. If a refactor
  // ever regenerates this table generically, this test is what catches it.
  assert.equal(sayFor(huruf("qof"), "fatha"), "Qo");
  assert.equal(sayFor(huruf("tho"), "fatha"), "Tho");
  assert.equal(sayFor(huruf("shod"), "fatha"), "Sho");
  assert.equal(sayFor(huruf("dhod"), "fatha"), "Dho");
  assert.equal(sayFor(huruf("zho"), "fatha"), "Zho");
  assert.equal(sayFor(huruf("ro"), "fatha"), "Ro");
  assert.equal(sayFor(huruf("kho"), "fatha"), "Kho");
  assert.equal(sayFor(huruf("ghoin"), "fatha"), "Gho");
  // And that the light letters are untouched.
  assert.equal(sayFor(huruf("ba"), "fatha"), "Ba");
  assert.equal(sayFor(huruf("ta"), "damma"), "Tu");
});

test("harakat compose onto the letter", () => {
  assert.equal(withHarakah(huruf("ba"), "fatha"), "بَ");
  assert.equal(withHarakah(huruf("ba"), "kasra"), "بِ");
  assert.equal(withHarakah(huruf("ba"), "damma"), "بُ");
  assert.equal(withHarakah(huruf("ba"), null), "ب");
  assert.equal(HARAKAT.length, 3);
});

test("audio keys are stable and distinct", () => {
  assert.equal(audioKey("ba"), "ba");
  assert.equal(audioKey("ba", "kasra"), "ba-kasra");
  const keys = HURUF.flatMap((h) => [audioKey(h.id), ...HARAKAT.map((k) => audioKey(h.id, k.id))]);
  assert.equal(keys.length, 28 * 4);
  assert.equal(new Set(keys).size, 28 * 4);
});

test("huruf() misses cleanly", () => {
  assert.equal(huruf("zzz"), null);
});

/* -------------------------------------------------------------- word cards */

test("all 12 combination cards carry four words each", () => {
  assert.equal(WORD_CARDS.length, 12);
  for (const c of WORD_CARDS) assert.equal(c.words.length, 4, `card ${c.id}`);
  assert.equal(allWords().length, 48);
});

test("words split into letter-plus-harakah units", () => {
  assert.deepEqual(syllables("سَجَدَ"), ["سَ", "جَ", "دَ"]);
  assert.deepEqual(syllables("بُنِتَ"), ["بُ", "نِ", "تَ"]);
  assert.equal(syllables("اَكَلَ").length, 3);
});

test("every drill word splits into at least three units", () => {
  for (const w of allWords()) {
    assert.ok(syllables(w).length >= 3, `${w} → ${syllables(w).length}`);
  }
});

test("the Persian characters the deck used are normalised away", () => {
  const joined = allWords().join("");
  assert.ok(!joined.includes("ی"), "Persian yeh ی should be ي");
  assert.ok(!joined.includes("ھ"), "Persian heh ھ should be ه");
});

test("syllables leaves a bare string alone", () => {
  assert.deepEqual(syllables(""), []);
  assert.deepEqual(syllables("ب"), ["ب"]);
});

/* ------------------------------------------------ generated asset agreement */

test("the audio generator's letters match the portal's", async () => {
  // scripts/generate-huruf-audio.mjs keeps its own copy of the table so it can
  // run standalone. The filenames it writes are what lib/games/audio.js asks
  // for, so if the two lists ever diverge every clip for the odd letter goes
  // silently missing — which is exactly the kind of break nobody notices until
  // a class is under way.
  const src = await readFile(new URL("../scripts/generate-huruf-audio.mjs", import.meta.url), "utf8");
  const table = src.slice(src.indexOf("const HURUF = ["), src.indexOf("const HARAKAT = ["));
  const ids = [...table.matchAll(/\["([a-z]+)", "(.)",/g)].map((m) => [m[1], m[2]]);

  assert.equal(ids.length, 28, "generator should list all 28 letters");
  assert.deepEqual(ids.map((i) => i[0]), HURUF.map((h) => h.id));
  assert.deepEqual(ids.map((i) => i[1]), HURUF.map((h) => h.char));
});

test("every letter's geometry is generated, with strokes and the right dots", async () => {
  // The dot counts are the deck's, and they are the cheapest possible check
  // that scripts/huruf-geometry.py still classifies marks correctly after a
  // tweak to its thresholds.
  const geometry = JSON.parse(
    await readFile(new URL("../public/huruf/geometry.json", import.meta.url), "utf8"),
  );
  const expectedDots = {
    alif: 0, ba: 1, ta: 2, tsa: 3, jim: 1, ha: 0, kho: 1, dal: 0, dzal: 1, ro: 0,
    zay: 1, sin: 0, syin: 3, shod: 0, dhod: 1, tho: 0, zho: 1, ain: 0, ghoin: 1,
    fa: 1, qof: 2, kaf: 0, lam: 0, mim: 0, nun: 1, hha: 0, wau: 0, ya: 2,
  };

  for (const h of HURUF) {
    const g = geometry.letters[h.id];
    assert.ok(g, `no geometry for ${h.id}`);
    assert.equal(g.char, h.char, `${h.id} geometry is the wrong letter`);
    assert.ok(g.outline.length > 40, `${h.id} has no outline`);
    assert.ok(g.strokes.length >= 1, `${h.id} has no traceable stroke`);
    assert.equal(g.dots.length, expectedDots[h.id], `${h.id} dot count`);
    for (const s of g.strokes) {
      assert.ok(s.d.startsWith("M"), `${h.id} stroke path`);
      assert.equal(s.start.length, 2);
      assert.equal(s.end.length, 2);
    }
  }

  // ط and ظ are written bowl first, upright last — two strokes, not one.
  assert.equal(geometry.letters.tho.strokes.length, 2);
  assert.equal(geometry.letters.zho.strokes.length, 2);
  // ك carries its inner mark as a second stroke.
  assert.equal(geometry.letters.kaf.strokes.length, 2);
});

test("an upright stroke is written downwards, not upwards", async () => {
  // ط and ظ are bowl-then-stem, and the stem is drawn from the top down. This
  // failed silently once: the direction check ran after the right-to-left flip
  // had already replaced the chain with a new list, so it never matched and
  // every stem was generated bottom-up. Nothing else in the pipeline notices,
  // which is exactly why it is pinned here.
  const geometry = JSON.parse(
    await readFile(new URL("../public/huruf/geometry.json", import.meta.url), "utf8"),
  );
  const forms = JSON.parse(
    await readFile(new URL("../public/huruf/forms.json", import.meta.url), "utf8"),
  );

  const uprights = [
    ["tho isolated", geometry.letters.tho],
    ["zho isolated", geometry.letters.zho],
    ...["init", "medi", "fina"].flatMap((f) => [
      [`tho ${f}`, forms.forms.tho[f]],
      [`zho ${f}`, forms.forms.zho[f]],
    ]),
  ];

  for (const [label, shape] of uprights) {
    assert.equal(shape.strokes.length, 2, `${label} should be bowl plus upright`);
    const stem = shape.strokes[1];
    assert.ok(
      stem.start[1] < stem.end[1],
      `${label}: the upright starts at y=${stem.start[1]} and ends at y=${stem.end[1]} — it is drawn upwards`,
    );
  }
});

test("every letter has all three positional forms generated", async () => {
  const forms = JSON.parse(
    await readFile(new URL("../public/huruf/forms.json", import.meta.url), "utf8"),
  );
  // Wider than the isolated letters: a letter plus its connector is a wide
  // shape, and squeezing it into a square would halve the size a child traces.
  assert.equal(forms.viewBox, "0 0 1000 560");

  for (const h of HURUF) {
    const set = forms.forms[h.id];
    assert.ok(set, `no forms for ${h.id}`);
    for (const form of ["init", "medi", "fina"]) {
      const g = set[form];
      assert.ok(g, `${h.id} has no ${form} form`);
      assert.ok(g.outline.length > 40, `${h.id} ${form} has no outline`);
      assert.ok(g.strokes.length >= 1, `${h.id} ${form} has no traceable stroke`);
      for (const stroke of g.strokes) {
        assert.ok(stroke.points.length >= 2, `${h.id} ${form} stroke has no polyline`);
        // Nothing may escape the box, or a child would be asked to trace off
        // the edge of the screen.
        for (const [x, y] of stroke.points) {
          assert.ok(x >= 0 && x <= 1000, `${h.id} ${form} x=${x} outside the box`);
          assert.ok(y >= 0 && y <= 560, `${h.id} ${form} y=${y} outside the box`);
        }
      }
    }
  }
});

test("a letter's dots do not change with its position", async () => {
  // Joining a letter changes its body, never how many dots it carries. This is
  // the check that catches a shaped run picking up a stray glyph — a detached
  // connector reads as a small blob and would land in the dot list.
  const forms = JSON.parse(
    await readFile(new URL("../public/huruf/forms.json", import.meta.url), "utf8"),
  );
  const geometry = JSON.parse(
    await readFile(new URL("../public/huruf/geometry.json", import.meta.url), "utf8"),
  );

  for (const h of HURUF) {
    const expected = geometry.letters[h.id].dots.length;
    for (const form of ["init", "medi", "fina"]) {
      assert.equal(
        forms.forms[h.id][form].dots.length,
        expected,
        `${h.id} ${form} has ${forms.forms[h.id][form].dots.length} dots, isolated has ${expected}`,
      );
    }
  }
});

test("the six non-joining letters have no distinct initial form", async () => {
  // ا د ذ ر ز و join on the right only. Their initial form is the bare letter
  // and their medial is the same as their final — which is exactly how the deck
  // prints them (د / ـد / ـد). If shaping ever starts inventing a left-joining
  // د, these three shapes stop being two.
  const forms = JSON.parse(
    await readFile(new URL("../public/huruf/forms.json", import.meta.url), "utf8"),
  );
  for (const id of ["alif", "dal", "dzal", "ro", "zay", "wau"]) {
    const { init, medi, fina } = forms.forms[id];
    assert.equal(medi.outline, fina.outline, `${id}: medial and final should be the same shape`);
    assert.notEqual(init.outline, fina.outline, `${id}: initial should be the bare letter`);
  }

  // A letter that joins both sides must differ in all three.
  for (const id of ["ba", "sin", "kaf"]) {
    const { init, medi, fina } = forms.forms[id];
    assert.notEqual(init.outline, medi.outline, `${id}: initial and medial should differ`);
    assert.notEqual(medi.outline, fina.outline, `${id}: medial and final should differ`);
  }
});

/* ------------------------------------------------- finger-sized tolerances */

test("scaleFor leaves a large screen exactly as it was", () => {
  // The physical floors are stated for a 10-inch tablet, so at that size and
  // anywhere roomier nothing may change: the big-screen feel is the one that
  // was reported as good, and this fix must not touch it.
  for (const name of ["easy", "proper"]) {
    const base = levelFor(name);
    const tablet = scaleFor(base, 1.43);
    assert.equal(Math.round(tablet.tolerance), base.tolerance);
    assert.equal(Math.round(tablet.lookAhead), base.lookAhead);

    const tv = scaleFor(base, 1.14);
    assert.equal(tv.tolerance, base.tolerance, "a TV must not get stricter");
    assert.equal(tv.lookAhead, base.lookAhead);
  }
});

test("scaleFor is never stricter than the unit baseline, at any size", () => {
  // The whole fix is a floor, not a replacement. If this ever went the other
  // way, some device would silently become harder to trace on.
  for (const name of ["easy", "proper"]) {
    const base = levelFor(name);
    for (const u of [0.2, 0.5, 1, 1.14, 1.43, 2, 2.67, 4]) {
      const s = scaleFor(base, u);
      assert.ok(s.tolerance >= base.tolerance, `${name} tolerance shrank at ${u}`);
      assert.ok(s.lookAhead >= base.lookAhead, `${name} lookAhead shrank at ${u}`);
    }
  }
});

test("scaleFor loosens meaningfully on a phone", () => {
  // 2.67 units per CSS pixel is a 390px-wide phone, measured in the browser.
  const easy = scaleFor(levelFor("easy"), 2.67);
  const proper = scaleFor(levelFor("proper"), 2.67);
  assert.ok(easy.tolerance > 180, `easy band only ${easy.tolerance} units`);
  assert.ok(proper.tolerance > 100, `proper band only ${proper.tolerance} units`);
  // In physical terms both bands must now clear a fingertip (~40px across, so
  // ~20px either side of the path).
  assert.ok(easy.tolerance / 2.67 >= 40);
  assert.ok(proper.tolerance / 2.67 >= 20);
});

test("scaleFor passes the level's other rules through untouched", () => {
  const proper = scaleFor(levelFor("proper"), 2.67);
  assert.equal(proper.requireStart, true);
  assert.equal(proper.completeAt, 0.94);
  assert.equal(scaleFor(levelFor("easy"), 2.67).requireStart, false);
});

test("scaleFor survives a nonsense scale rather than breaking the trace", () => {
  // unitsPerPx comes from a measured bounding box, which is 0 for one render
  // before layout settles, and NaN if the element is detached. Neither may
  // produce a tolerance of 0 — that would make the letter untraceable.
  const base = levelFor("easy");
  for (const bad of [0, -1, NaN, Infinity, undefined, null]) {
    const s = scaleFor(base, bad);
    assert.equal(s.tolerance, base.tolerance, `broke on ${String(bad)}`);
    assert.equal(s.lookAhead, base.lookAhead);
  }
});

test("A FINGERTIP WOBBLE STAYS ON THE ROAD ON A PHONE", () => {
  // The regression this fix exists for, end to end.
  //
  // A straight stroke and a finger some CSS pixels off the centre line. The
  // wobble chosen for each level is one that the old unit-only band rejected
  // at phone size but that is still within a fingertip of the path — i.e. a
  // child tracing correctly, whose glow used to stop anyway.
  //
  // Proper is where this bit hardest: its band was 23 CSS px on a phone,
  // narrower than the finger tracing it.
  const points = [[500, 100], [500, 900]];
  const cums = cumulative(points);
  const phone = 2.67;

  for (const [name, wobblePx] of [["proper", 30], ["easy", 45]]) {
    const off = wobblePx * phone; // CSS px → viewBox units on a phone
    const at = { points, cums, pointer: [500 + off, 300], progress: 150, started: true };

    const before = advance({ ...at, level: levelFor(name) });
    assert.equal(before.state, "off", `${name}: the old band accepted ${wobblePx}px after all`);

    const after = advance({ ...at, level: scaleFor(levelFor(name), phone) });
    assert.equal(after.state, "advanced", `${name}: a ${wobblePx}px wobble must stay on the road`);
    assert.ok(after.progress > 150);
  }
});

test("a phone's wider band still refuses a genuine stray", () => {
  // Loosening must not turn into "anywhere near the letter counts". Two
  // fingertips off the path is someone not tracing.
  const points = [[500, 100], [500, 900]];
  const cums = cumulative(points);
  const rules = scaleFor(levelFor("easy"), 2.67);
  const far = advance({
    points, cums, pointer: [500 + 90 * 2.67, 300],
    progress: 150, level: rules, started: true,
  });
  assert.equal(far.state, "off");
});

test("a phone's wider lookAhead still refuses a skip to the end", () => {
  // lookAhead grew too, so check the no-skip guarantee survives it.
  const points = [[500, 100], [500, 900]];
  const cums = cumulative(points);
  const rules = scaleFor(levelFor("easy"), 2.67);
  const skip = advance({
    points, cums, pointer: [500, 880],
    progress: 20, level: rules, started: true,
  });
  assert.equal(skip.state, "off", "touching the end at 20 must not jump there");
});

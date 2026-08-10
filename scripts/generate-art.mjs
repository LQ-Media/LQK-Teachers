// Regenerates the portal's illustrated art from scripts/art/manifest.mjs.
//
//   GEMINI_API_KEY=... node scripts/generate-art.mjs            # everything
//   GEMINI_API_KEY=... node scripts/generate-art.mjs spot       # one folder
//   GEMINI_API_KEY=... node scripts/generate-art.mjs spot/qibla # one image
//
// Each image is generated on a flat white ground, keyed to a real alpha
// channel by scripts/art/matte.mjs, then written to public/<dir>/<slug>.png.
// Read the header of manifest.mjs before changing a prompt — the colour rules
// there are deliberate, and the two sacred subjects are not negotiable.
//
// Costs money and takes a few minutes. It overwrites checked-in art, so run it
// on a clean tree and eyeball the diff.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allArt } from "./art/manifest.mjs";
import { keyOutWhite, transparentShare } from "./art/matte.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.LQK_ART_MODEL || "gemini-3-pro-image-preview";
const CONCURRENCY = 4;

if (!KEY) {
  console.error("GEMINI_API_KEY is not set. Put it in .env.local and export it, or pass it inline.");
  process.exit(1);
}

async function askForImage(prompt) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
  };
  let lastError = "unknown";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    );
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const part = (json.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
      if (part) return Buffer.from(part.inlineData.data, "base64");
      lastError = "response carried no image";
    } else {
      lastError = json.error?.message || `HTTP ${res.status}`;
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(lastError);
}

async function build({ dir, slug, size, prompt }) {
  const raw = await askForImage(prompt);
  const png = await keyOutWhite(raw, { size });
  const clear = await transparentShare(png);
  // A good icon sits somewhere around a third to four-fifths clear. Far outside
  // that and the key went wrong — either the model ignored the white ground
  // (nothing removed) or the subject itself got eaten (almost nothing left).
  if (clear < 0.12 || clear > 0.93) {
    throw new Error(`suspicious matte: ${(clear * 100).toFixed(1)}% transparent`);
  }
  const out = path.join(ROOT, "public", dir, `${slug}.png`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, png);
  return { out: path.relative(ROOT, out), clear };
}

const filter = process.argv[2];
const queue = allArt().filter(
  (a) => !filter || a.dir === filter || `${a.dir}/${a.slug}` === filter
);
if (!queue.length) {
  console.error(`Nothing matches "${filter}".`);
  process.exit(1);
}

console.log(`${queue.length} image(s) via ${MODEL}\n`);
const failures = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const label = `${item.dir}/${item.slug}`;
      try {
        const { out, clear } = await build(item);
        console.log(`  ok    ${out}  (${(clear * 100).toFixed(0)}% transparent)`);
      } catch (err) {
        console.log(`  FAIL  ${label}  ${err.message}`);
        failures.push(label);
      }
    }
  })
);

console.log(`\n${queue.length - failures.length}/${queue.length} written`);
if (failures.length) {
  console.log(`retry: node scripts/generate-art.mjs ${failures.join(" ")}`);
  process.exit(1);
}

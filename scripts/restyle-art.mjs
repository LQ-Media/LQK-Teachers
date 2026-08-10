// Image-to-image pass over the LQK character art (see the EDITS block in
// scripts/art/manifest.mjs for why these are edited rather than regenerated).
//
//   GEMINI_API_KEY=... node scripts/restyle-art.mjs                  # all
//   GEMINI_API_KEY=... node scripts/restyle-art.mjs empty/hours      # one
//
// Sends the CURRENT file back to the model with a "change only this" prompt,
// keys the returned white ground out to alpha, and overwrites the original.
// Because it reads what is on disk, running it twice compounds — check the
// diff after each run rather than re-running blind.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { allEdits } from "./art/manifest.mjs";
import { keyOutWhite, transparentShare } from "./art/matte.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.LQK_ART_MODEL || "gemini-3-pro-image-preview";

if (!KEY) {
  console.error("GEMINI_API_KEY is not set.");
  process.exit(1);
}

async function edit(prompt, sourcePath) {
  const src = readFileSync(sourcePath);
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: "image/png", data: src.toString("base64") } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { responseModalities: ["IMAGE"] },
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

const filter = process.argv[2];
const queue = allEdits().filter(
  (e) => !filter || e.dir === filter || `${e.dir}/${e.slug}` === filter || e.slug === filter
);
if (!queue.length) {
  console.error(`Nothing matches "${filter}".`);
  process.exit(1);
}

console.log(`${queue.length} restyle(s) via ${MODEL}\n`);
const failures = [];
for (const item of queue) {
  const target = path.join(ROOT, "public", item.source);
  const label = `${item.dir === "." ? "" : item.dir + "/"}${item.slug}`;
  try {
    const raw = await edit(item.prompt, target);
    let png = await keyOutWhite(raw);
    // Non-square art (the dashboard hero) keeps its own aspect: trim the keyed
    // result to its subject and cap the long edge instead of forcing a square.
    png = await sharp(png)
      .trim({ threshold: 1 })
      .resize({ width: item.size, height: item.size, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const clear = await transparentShare(png);
    if (clear < 0.05 || clear > 0.93) throw new Error(`suspicious matte: ${(clear * 100).toFixed(1)}% transparent`);
    writeFileSync(target, png);
    const { width, height } = await sharp(png).metadata();
    console.log(`  ok    public/${item.source}  ${width}x${height}  (${(clear * 100).toFixed(0)}% transparent)`);
  } catch (err) {
    console.log(`  FAIL  ${label}  ${err.message}`);
    failures.push(label);
  }
}

console.log(`\n${queue.length - failures.length}/${queue.length} restyled`);
if (failures.length) process.exit(1);

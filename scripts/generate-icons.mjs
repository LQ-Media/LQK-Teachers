// Regenerates the home-screen / PWA app icons from the LQK brand artwork.
//
// Source: scripts/app-icon-source.png (the terracotta "LQK Teachers Portal"
// illustration). It has transparent side margins, so we flatten it onto the
// artwork's own terracotta first, giving a seamless full-bleed square. Outputs:
//   app/apple-icon.png          → iPhone/iPad "Add to Home Screen" (180×180)
//   public/icon-192.png         → Android manifest icon (purpose "any")
//   public/icon-512.png         → Android manifest icon (purpose "any")
//   public/icon-maskable-512.png→ Android adaptive icon (purpose "maskable")
//
// The maskable variant is inset so Android's circular mask never clips the
// wordmark or figure. To swap the icon, replace app-icon-source.png and re-run:
//   node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "scripts/app-icon-source.png");

// The artwork's terracotta ground (sampled from the source). Fills the
// transparent margins and the maskable inset so everything is one seamless bg.
const GROUND = "#B05828";

async function fullBleed(size, outPath) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(SOURCE).flatten({ background: GROUND }).resize(size, size, { fit: "cover" }).png().toFile(outPath);
  console.log("wrote", path.relative(ROOT, outPath), `(${size}×${size})`);
}

// Maskable: shrink the art to `inset` of the canvas, centred on the ground,
// so the OS safe-zone crop never eats the wordmark/figure.
async function maskable(size, inset, outPath) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  const art = await sharp(SOURCE).flatten({ background: GROUND }).resize(inset, inset, { fit: "cover" }).png().toBuffer();
  const off = Math.round((size - inset) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: GROUND } })
    .composite([{ input: art, top: off, left: off }])
    .png()
    .toFile(outPath);
  console.log("wrote", path.relative(ROOT, outPath), `(${size}×${size}, inset ${inset})`);
}

await fullBleed(180, path.join(ROOT, "app/apple-icon.png"));
await fullBleed(192, path.join(ROOT, "public/icon-192.png"));
await fullBleed(512, path.join(ROOT, "public/icon-512.png"));
await maskable(512, 400, path.join(ROOT, "public/icon-maskable-512.png"));
console.log("done");

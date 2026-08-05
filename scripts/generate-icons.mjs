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
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "scripts/app-icon-source.png");

// The source artwork is white line work on one flat terracotta ground, from the
// portal's original olive/gold identity. Rather than redraw it for the pastel
// rose palette, we rotate its hue: the ground moves to rose and the white
// strokes stay white (a hue rotation cannot tint an unsaturated pixel). Keeps
// the brand illustration pixel-for-pixel while matching the new theme.
const SOURCE_GROUND = "#B05828"; // the artwork's own terracotta, pre-shift
const ROSE_SHIFT = { hue: 320, saturation: 0.85, brightness: 1.32 };
// What SOURCE_GROUND becomes after the shift. Used for the maskable canvas and
// mirrored by manifest.background_color so the splash screen matches.
const GROUND = "#E47687";

/** A fresh pipeline: transparent margins filled, then recoloured to rose. */
function art() {
  return sharp(SOURCE).flatten({ background: SOURCE_GROUND }).modulate(ROSE_SHIFT);
}

async function fullBleed(size, outPath) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  await art().resize(size, size, { fit: "cover" }).png().toFile(outPath);
  console.log("wrote", path.relative(ROOT, outPath), `(${size}×${size})`);
}

// Build a real multi-resolution .ico (browser tab / bookmarks). ICO is a small
// container: 6-byte header, one 16-byte directory entry per image, then the
// image payloads — PNG payloads are valid in ICO and understood by every
// modern browser, so we embed the PNGs directly.
async function writeIco(sizes, outPath) {
  // ensureAlpha() is required: Next's ICO decoder rejects embedded PNGs that
  // aren't RGBA ("The PNG is not in RGBA format!"), and flatten() drops alpha.
  const pngs = await Promise.all(
    sizes.map((s) => art().resize(s, s, { fit: "cover" }).ensureAlpha().png().toBuffer())
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); // width  (0 means 256)
    e.writeUInt8(s >= 256 ? 0 : s, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.concat([header, ...entries, ...pngs]));
  console.log("wrote", path.relative(ROOT, outPath), `(${sizes.join(", ")})`);
}

// Maskable: shrink the art to `inset` of the canvas, centred on the ground,
// so the OS safe-zone crop never eats the wordmark/figure.
async function maskable(size, inset, outPath) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  const inner = await art().resize(inset, inset, { fit: "cover" }).png().toBuffer();
  const off = Math.round((size - inset) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: GROUND } })
    .composite([{ input: inner, top: off, left: off }])
    .png()
    .toFile(outPath);
  console.log("wrote", path.relative(ROOT, outPath), `(${size}×${size}, inset ${inset})`);
}

await fullBleed(180, path.join(ROOT, "app/apple-icon.png"));
await fullBleed(192, path.join(ROOT, "public/icon-192.png"));
await fullBleed(512, path.join(ROOT, "public/icon-512.png"));
await maskable(512, 400, path.join(ROOT, "public/icon-maskable-512.png"));
await writeIco([16, 32, 48], path.join(ROOT, "app/favicon.ico"));
console.log("done");

// Regenerates every app icon and favicon from ONE source of truth:
// brand/lqk-logo.svg — the authentic LQK monogram (L · Q-with-crescent-and-star
// · K) in the brand orange #F0A41F, exactly as supplied by Karim.
//
// Rule (Aug 2026): nothing else may stand in for the logo. The portal used to
// ship a *tinted* copy of this mark (rose #DE7E9F) and a separate "LQK Teachers
// Portal" terracotta illustration; both are retired. If an icon needs
// regenerating, it comes from this SVG and no other file.
//
// Outputs:
//   app/favicon.ico             → browser tab (16/32/48, transparent)
//   app/apple-icon.png          → iOS "Add to Home Screen" (180x180, opaque —
//                                 iOS composites transparency onto black)
//   public/icon-192.png         → Android manifest icon, purpose "any" (transparent)
//   public/icon-512.png         → Android manifest icon, purpose "any" (transparent)
//   public/icon-maskable-512.png→ Android adaptive icon (opaque, inset for the
//                                 circular safe zone)
//
//   node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGO = path.join(ROOT, "brand/lqk-logo.svg");

// The cream page colour. Used wherever an icon must be opaque, so the tile
// looks like a swatch of the portal rather than a foreign plate.
const GROUND = "#FBF6EC";

/**
 * The logo, trimmed to its own ink and re-padded to a square with `margin`
 * (a fraction of the final size) of clear space on every side.
 *
 * The SVG carries generous, *uneven* artboard margins, so rendering it
 * straight to a square leaves the mark visibly off-centre and small. Trimming
 * to the alpha bounding box first makes the optical size and centring
 * identical at every output resolution.
 */
async function mark(size, margin) {
  // Render well above the target so the trim + downscale stays crisp.
  const trimmed = await sharp(LOGO, { density: 900 })
    .resize({ width: 1600, height: 1600, fit: "inside" })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();

  const inner = Math.max(1, Math.round(size * (1 - 2 * margin)));
  const art = await sharp(trimmed)
    .resize(inner, inner, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const { width, height } = await sharp(art).metadata();

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: art, top: Math.round((size - height) / 2), left: Math.round((size - width) / 2) },
    ])
    .png()
    .toBuffer();
}

async function write(buf, outPath, label) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  console.log("wrote", path.relative(ROOT, outPath), label);
}

/** Transparent PNG — the mark alone, no plate. */
async function transparent(size, margin, outPath) {
  await write(await mark(size, margin), outPath, `(${size}x${size}, transparent)`);
}

/** Opaque PNG — the mark on the cream ground. */
async function onCream(size, margin, outPath) {
  const art = await mark(size, margin);
  const buf = await sharp({ create: { width: size, height: size, channels: 4, background: GROUND } })
    .composite([{ input: art }])
    .png()
    .toBuffer();
  await write(buf, outPath, `(${size}x${size}, on ${GROUND})`);
}

// Build a real multi-resolution .ico (browser tab / bookmarks). ICO is a small
// container: 6-byte header, one 16-byte directory entry per image, then the
// image payloads — PNG payloads are valid in ICO and understood by every
// modern browser, so we embed the PNGs directly.
async function writeIco(sizes, outPath) {
  // ensureAlpha() is required: Next's ICO decoder rejects embedded PNGs that
  // aren't RGBA ("The PNG is not in RGBA format!").
  const pngs = await Promise.all(
    sizes.map(async (s) => sharp(await mark(s, 0.04)).ensureAlpha().png().toBuffer())
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

// Margins: "any" icons carry their own breathing room because Android draws
// them unmasked; the maskable variant needs a much bigger inset (~20%) so the
// OS circle crop never bites the K or the crescent.
await transparent(192, 0.08, path.join(ROOT, "public/icon-192.png"));
await transparent(512, 0.08, path.join(ROOT, "public/icon-512.png"));
await onCream(180, 0.1, path.join(ROOT, "app/apple-icon.png"));
await onCream(512, 0.2, path.join(ROOT, "public/icon-maskable-512.png"));
await writeIco([16, 32, 48], path.join(ROOT, "app/favicon.ico"));
console.log("done");

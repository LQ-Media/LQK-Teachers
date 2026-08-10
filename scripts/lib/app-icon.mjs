// Shared app-icon builder: turns ONE piece of source artwork into the full set
// of home-screen / PWA / favicon files.
//
// Why this exists at all: the artwork Karim supplies is exported from a 3D tool
// with the *transparency checkerboard painted into the pixels* — the files carry
// an alpha channel, but every pixel in it is opaque, so a plain `trim()` or a
// flatten() sees a grey-and-white checker rather than empty space. Everything
// below is about recovering the real subject from that.
//
// The pipeline:
//   1. `subject()`  — flood-fill the checker away from the borders, keep only
//      the largest connected blob, and return its bounding box.
//   2. `bleed()` / `pad()` — two ways to seat that subject on a square canvas.
//   3. `buildIconSet()` — writes apple-icon / manifest icons / favicon.
//
// Icons are always written OPAQUE. iOS mattes any transparency in an
// apple-touch-icon to solid black, and Android's adaptive mask needs a plate to
// cut a shape out of.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Largest per-channel difference between two RGB triplets. */
function dist(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/**
 * Recover the artwork's real subject from a checkerboard-flattened export.
 *
 * @param {string} src   path to the source PNG
 * @param {number} tol   per-channel tolerance when matching checker greys. The
 *                       checker is flat colour, so this only has to absorb JPEG
 *                       -ish ringing; keep it well below the contrast between
 *                       the checker and any real artwork.
 * @param {boolean} clearEnclosed  clear checker the subject wraps *around* — the
 *                       gap under a bag handle, the inside of a ring. The border
 *                       fill can't reach those, and they don't come out as blobs
 *                       of their own either: the anti-aliased rim stitches them
 *                       to the subject. So this drops the flood fill and matches
 *                       the checker greys by colour alone.
 *                       Only safe when the artwork holds no flat area near those
 *                       greys — fine for the store's cream-and-gold bag against
 *                       a mid-grey checker, NOT for artwork with white pages
 *                       against a white-and-light-grey one.
 * @returns {{data: Buffer, info: object, mask: Uint8Array, box: {left:number,top:number,width:number,height:number}}}
 */
export async function subject(src, { tol = 26, clearEnclosed = false } = {}) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  // The two checker greys are, by construction, the most common colours along
  // the border. Sample exact values rather than quantising — the checker is
  // flat, so the top two distinct border colours are exactly right.
  const counts = new Map();
  const tally = (x, y) => {
    const i = (y * W + x) * C;
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  };
  for (let x = 0; x < W; x++) {
    tally(x, 0);
    tally(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    tally(0, y);
    tally(W - 1, y);
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  const checker = [];
  for (const c of ranked) {
    if (checker.every((seen) => dist(seen, c) > tol)) checker.push(c);
    if (checker.length === 2) break;
  }

  const isChecker = (i) => checker.some((c) => dist([data[i], data[i + 1], data[i + 2]], c) <= tol);

  // Flood-fill the checker inward from every border pixel. Fill rather than a
  // plain colour test so that any grey *inside* the artwork (a highlight, the
  // white of a page) is never mistaken for background.
  const bg = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0;
  const push = (p) => {
    if (!bg[p] && isChecker(p * C)) {
      bg[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % W;
    const y = (p / W) | 0;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (y > 0) push(p - W);
    if (y < H - 1) push(p + W);
  }

  if (clearEnclosed) for (let p = 0; p < W * H; p++) if (!bg[p] && isChecker(p * C)) bg[p] = 1;

  // Label every remaining foreground blob and keep only the biggest one.
  //
  // This single rule cleans up three separate messes at once: checker trapped in
  // an enclosed gap (the space under the bag's handles, which the border fill
  // can never reach), the sparkle watermark the image generator stamps in a
  // corner, and the odd stray checker cell whose colour drifted just outside
  // `tol`. All of them are components of their own; the artwork is one blob.
  const label = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const boxes = [];
  for (let start = 0; start < W * H; start++) {
    if (bg[start] || label[start] >= 0) continue;
    const id = sizes.length;
    let sp2 = 0;
    stack[sp2++] = start;
    label[start] = id;
    let n = 0;
    let l = W;
    let r = -1;
    let t = H;
    let b = -1;
    while (sp2 > 0) {
      const p = stack[--sp2];
      n++;
      const x = p % W;
      const y = (p / W) | 0;
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) {
        if (q >= 0 && !bg[q] && label[q] < 0) {
          label[q] = id;
          stack[sp2++] = q;
        }
      }
    }
    sizes.push(n);
    boxes.push({ left: l, top: t, width: r - l + 1, height: b - t + 1 });
  }
  if (!sizes.length) throw new Error(`no subject found in ${src} — is it all background?`);
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;

  // Re-cut the alpha channel so the subject can be composited cleanly.
  const out = Buffer.from(data);
  for (let p = 0; p < W * H; p++) if (label[p] !== main) out[p * C + 3] = 0;

  return { data: out, info, box: boxes[main] };
}

/** The subject as a standalone RGBA PNG buffer, cropped to its bounding box. */
async function cropped(src, tol, clearEnclosed) {
  const { data, info, box } = await subject(src, { tol, clearEnclosed });
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .extract(box)
    .png()
    .toBuffer();
  return { png, box };
}

/**
 * Full-bleed treatment, for artwork that is already an app-icon *plate* (a
 * rounded square that fills the frame).
 *
 * The plate's own rounded corners are cropped away — `inset` trims just past
 * the corner arcs — so the colour runs edge to edge and iOS/Android apply their
 * own mask to a solid square. Without this you get the artwork's rounding
 * showing *inside* the OS rounding, with checker-grey slivers in the gaps.
 *
 * A rounded rect with corner radius r leaves its widest gap r·(1−1/√2) ≈ 0.29r
 * in from each edge, so for a typical r ≈ 20% of the width, a 6.5% inset clears
 * it with room to spare.
 */
export async function bleed(src, size, { inset = 0.065, tol = 26, clearEnclosed = false } = {}) {
  const { png, box } = await cropped(src, tol, clearEnclosed);
  const dx = Math.round(box.width * inset);
  const dy = Math.round(box.height * inset);
  return sharp(png)
    .extract({ left: dx, top: dy, width: box.width - dx * 2, height: box.height - dy * 2 })
    .resize(size, size, { fit: "cover" })
    .flatten({ background: "#000000" }) // nothing should remain transparent here
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Padded treatment, for artwork that is a free-floating object rather than a
 * plate. The subject is centred on `ground` with `margin` of clear space.
 */
export async function pad(src, size, { ground, margin = 0.1, tol = 26, clearEnclosed = false } = {}) {
  const { png } = await cropped(src, tol, clearEnclosed);
  const inner = Math.max(1, Math.round(size * (1 - 2 * margin)));
  const art = await sharp(png)
    .resize(inner, inner, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const { width, height } = await sharp(art).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: ground } })
    .composite([{ input: art, top: Math.round((size - height) / 2), left: Math.round((size - width) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * A real multi-resolution .ico. ICO is a thin container: 6-byte header, one
 * 16-byte directory entry per image, then the payloads. PNG payloads are legal
 * inside ICO and understood by every browser we care about.
 */
export async function ico(pngs, sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); // 0 means 256
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2); // palette size
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}

export function write(buf, outPath, label = "") {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  console.log("wrote", outPath, label);
}

/**
 * Write the whole icon set for one site.
 *
 * @param {object} o
 * @param {string} o.src      the single source artwork — the one file to swap
 *                            when the logo changes
 * @param {string} o.root     repo root
 * @param {"bleed"|"pad"} o.mode
 * @param {string} o.ground   plate colour for `pad` mode
 * @param {object} o.out      { apple, icon192, icon512, maskable, favicon } paths
 */
export async function buildIconSet({ src, mode, ground, margin = 0.1, inset = 0.065, clearEnclosed = false, out }) {
  // `any` icons are drawn unmasked by Android, `maskable` gets clipped to a
  // circle-ish shape, so the maskable variant needs its content pulled further
  // in. For a plate that means a deeper crop; for a floating object, more pad.
  const make = (size, opts = {}) =>
    mode === "bleed"
      ? bleed(src, size, { inset: opts.inset ?? inset, clearEnclosed })
      : pad(src, size, { ground, margin: opts.margin ?? margin, clearEnclosed });

  if (out.apple) write(await make(180), out.apple, "(180×180, iOS home screen)");
  if (out.icon192) write(await make(192), out.icon192, "(192×192, manifest any)");
  if (out.icon512) write(await make(512), out.icon512, "(512×512, manifest any)");
  if (out.maskable) {
    // Android's mask can bite ~10% off each edge. A plate survives that on its
    // own (its artwork is already inset); a floating object must be shrunk.
    write(
      await make(512, { inset: inset, margin: Math.max(margin, 0.22) }),
      out.maskable,
      "(512×512, manifest maskable)"
    );
  }
  if (out.favicon) {
    const sizes = [16, 32, 48];
    const pngs = await Promise.all(sizes.map((s) => make(s).then((b) => sharp(b).ensureAlpha().png().toBuffer())));
    write(await ico(pngs, sizes), out.favicon, "(16/32/48)");
  }
  for (const [size, p] of Object.entries(out.extra || {})) {
    write(await make(Number(size)), p, `(${size}×${size})`);
  }
}

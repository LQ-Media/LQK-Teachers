// Turn a flat-white-ground render into a clean transparent PNG.
//
// Why this exists: the Gemini image models never return an alpha channel —
// they return JPEG. Ask one for a "transparent background" and it cheerfully
// *paints a checkerboard*. So every piece of art in this portal is generated
// on a flat pure-white ground and keyed out here instead.
//
// Why not just `mix-blend-mode: multiply` in CSS (what the empty states used
// to do): multiply only disappears against a near-white surface, it darkens
// the art on any tinted fill, and it cannot be used inside a rounded tile or
// over a photo. A real alpha channel blends against ANY background, which is
// the whole requirement.
//
// The algorithm, in three steps:
//
//  1. Flood-fill inward from the border. Only background *connected to the
//     edge* is removed, so the white page of an open book or the whites of an
//     eye survive — a global "delete every white pixel" pass would gut them.
//  2. Feather the resulting mask by a sub-pixel blur, so edges keep their
//     anti-aliasing instead of turning into stair-steps.
//  3. Un-premultiply against white. An anti-aliased edge pixel is a blend of
//     object and background, so it carries white in it; dropping alpha without
//     removing that white leaves the classic pale halo when the art lands on a
//     dark or saturated surface. Solving C = a·F + (1-a)·255 for F removes it.
import sharp from "sharp";

/**
 * @param {Buffer|string} input        source image (any format sharp reads)
 * @param {object}  [opts]
 * @param {number}  [opts.tolerance=18]  how far from pure white still counts as
 *   background, per channel. Renders are rarely a perfect 255 — soft studio
 *   falloff lands around 246-252 — but push this past ~30 and pale clay starts
 *   dissolving from the outside in.
 * @param {number}  [opts.feather=0.7]   blur sigma applied to the alpha mask.
 * @param {number}  [opts.size]          output square size (optional resize).
 * @returns {Promise<Buffer>} PNG with a real alpha channel
 */
export async function keyOutWhite(input, { tolerance = 18, feather = 0.7, size } = {}) {
  const src = sharp(input).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;

  // --- 1. flood fill from the border ------------------------------------
  const isBg = new Uint8Array(w * h);
  const stack = [];
  const near = (i) => {
    const o = i * ch;
    return data[o] >= 255 - tolerance && data[o + 1] >= 255 - tolerance && data[o + 2] >= 255 - tolerance;
  };
  const push = (i) => {
    if (!isBg[i] && near(i)) {
      isBg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  // --- 2. feather the mask ----------------------------------------------
  // 255 = keep, 0 = drop. Blurred so the boundary gets a soft ramp.
  const mask = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = isBg[i] ? 0 : 255;
  let alpha = mask;
  let stride = 1;
  if (feather) {
    // sharp does not promise to hand a 1-channel raw buffer back as 1 channel —
    // it may widen it to greyscale RGB. Read the reported channel count and
    // stride by it rather than assuming, or the mask gets sampled at 1/3 scale
    // and the art comes back smeared into wedges.
    const blurred = await sharp(mask, { raw: { width: w, height: h, channels: 1 } })
      .blur(feather)
      .raw()
      .toBuffer({ resolveWithObject: true });
    alpha = blurred.data;
    stride = blurred.info.channels;
  }

  // --- 3. un-premultiply against white ----------------------------------
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i * stride];
    const o = i * ch;
    const p = i * 4;
    if (a === 0) {
      out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
      continue;
    }
    const f = a / 255;
    for (let c = 0; c < 3; c++) {
      const v = (data[o + c] - 255 * (1 - f)) / f;
      out[p + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
    out[p + 3] = a;
  }

  let pipe = sharp(out, { raw: { width: w, height: h, channels: 4 } });
  if (size) pipe = pipe.resize(size, size, { fit: "inside" });
  return pipe.png({ compressionLevel: 9 }).toBuffer();
}

/** Fraction of fully transparent pixels — a quick sanity check after keying. */
export async function transparentShare(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 8) n++;
  return n / (info.width * info.height);
}

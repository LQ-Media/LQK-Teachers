// Pure geometry for the profile-photo cropper — no React, no DOM, so it can be
// reasoned about and tested on its own. components/AvatarCropper.js owns the
// gestures and the canvas; everything that could be subtly wrong lives here.
//
// Coordinate systems:
//   • "source"   — pixels of the original image.
//   • "viewport" — the square on-screen crop area, VIEWPORT px per side.
// `offset` is the image's top-left corner expressed in viewport pixels, so it is
// zero or negative once the image covers the viewport.

/** The scale at which the shorter edge exactly fills the viewport (no gaps). */
export function coverScale(natW, natH, viewport) {
  return Math.max(viewport / natW, viewport / natH);
}

/** Displayed size of the image at a given zoom multiplier. */
export function displaySize(natW, natH, viewport, zoom) {
  const scale = coverScale(natW, natH, viewport) * zoom;
  return { scale, width: natW * scale, height: natH * scale };
}

/**
 * Hold the image over the whole viewport: never let a gap appear inside the
 * circle, on either axis.
 */
export function clampOffset(offset, displayW, displayH, viewport) {
  return {
    x: Math.min(0, Math.max(viewport - displayW, offset.x)),
    y: Math.min(0, Math.max(viewport - displayH, offset.y)),
  };
}

/** Offset that centres the image in the viewport at the given zoom. */
export function centredOffset(natW, natH, viewport, zoom = 1) {
  const { width, height } = displaySize(natW, natH, viewport, zoom);
  return { x: (viewport - width) / 2, y: (viewport - height) / 2 };
}

/**
 * Zooming should pull toward the middle of the circle rather than the image's
 * corner, so keep whatever sits at the viewport centre pinned while scaling.
 */
export function offsetForZoom(offset, natW, natH, viewport, fromZoom, toZoom) {
  const from = displaySize(natW, natH, viewport, fromZoom);
  const to = displaySize(natW, natH, viewport, toZoom);
  const ratio = to.scale / from.scale;
  const centreX = viewport / 2 - offset.x; // centre, in old displayed px
  const centreY = viewport / 2 - offset.y;
  return clampOffset(
    { x: viewport / 2 - centreX * ratio, y: viewport / 2 - centreY * ratio },
    to.width,
    to.height,
    viewport
  );
}

/**
 * The square of the ORIGINAL image currently framed by the circle, ready to hand
 * to canvas drawImage(). Clamped to the image bounds so a rounding error can
 * never sample outside it and paint a transparent edge into the avatar.
 */
export function sourceRect(offset, natW, natH, viewport, zoom) {
  const { scale } = displaySize(natW, natH, viewport, zoom);
  const rawX = -offset.x / scale;
  const rawY = -offset.y / scale;
  const rawSize = viewport / scale;

  const x = Math.max(0, Math.min(natW, rawX));
  const y = Math.max(0, Math.min(natH, rawY));
  const size = Math.max(1, Math.min(rawSize, natW - x, natH - y));
  return { x, y, size };
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;

export function clampZoom(z) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : ZOOM_MIN));
}

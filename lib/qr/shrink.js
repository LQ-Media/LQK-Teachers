/* Re-encode an image in the browser before it is uploaded.

   Like lib/events/downscale.js, but it does NOT force JPEG.

   That difference matters here: the artwork Karim uploads is logos, and a logo
   is a PNG with a transparent background. Re-encoded as JPEG the transparency
   becomes a black rectangle, which is then faithfully composited into every
   family's picture. A photograph still becomes a JPEG, because a photograph
   has no alpha to lose and JPEG is a third the size.

   Returns { dataUrl, mime } — a plain string return is how the first version
   of this got misused. */

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

export async function shrinkImage(file, { maxEdge = MAX_EDGE } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  // PNG and WebP may carry alpha, so they stay lossless. Everything else — in
  // practice a phone photo — becomes a JPEG, which also strips EXIF, so we
  // aren't quietly collecting the GPS coordinates of families' homes.
  const keepAlpha = file.type === "image/png" || file.type === "image/webp";
  const mime = keepAlpha ? "image/png" : "image/jpeg";
  const dataUrl = keepAlpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { dataUrl, mime, width, height };
}

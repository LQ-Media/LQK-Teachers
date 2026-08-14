/* Re-encode an image in the browser before it is uploaded.

   Not an optimisation. A Next.js Server Action body is capped (10mb here, 1mb
   by default), phone photos are 2–8MB, and the failure mode is a 500 mid-submit
   that looks to the guest like the whole reply broke. Re-encoding to a 1400px
   JPEG also strips EXIF, so we aren't quietly collecting the GPS coordinates of
   guests' homes.

   Shared by the family photo and by any custom question of type "file". */

export const MAX_EDGE = 1400;
export const QUALITY = 0.82;
export const MAX_PICK_BYTES = 25 * 1024 * 1024;

export async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", QUALITY);
}

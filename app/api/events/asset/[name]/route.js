import { readFileSync, existsSync } from "node:fs";
import { eventAssetPath, ASSET_CONTENT_TYPE, isEventAssetFile } from "@/lib/events/assets";

// Serves an event logo or background off the persistent volume.
//
// Unauthenticated on purpose, and it is the only upload route in the app that
// is: these images are embedded in emails sitting in parents' inboxes and on
// the public invite page, so a session check would render both as broken
// images. The filename is a random UUID generated at upload — it is not
// enumerable, and nothing sensitive is stored here.
export async function GET(_request, ctx) {
  const { name } = await ctx.params;
  if (!isEventAssetFile(name)) return new Response("Not found", { status: 404 });

  const filePath = eventAssetPath(name);
  if (!filePath || !existsSync(filePath)) return new Response("Not found", { status: 404 });

  const ext = name.split(".").pop().toLowerCase();
  return new Response(readFileSync(filePath), {
    headers: {
      "Content-Type": ASSET_CONTENT_TYPE[ext] || "application/octet-stream",
      // Long cache: the filename changes whenever the image does, so a stale
      // copy is impossible and mail clients get to cache aggressively.
      "Cache-Control": "public, max-age=31536000, immutable",
      // An uploaded SVG can carry script. Neutralise it: refuse every
      // subresource and stop the browser sniffing a different type.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

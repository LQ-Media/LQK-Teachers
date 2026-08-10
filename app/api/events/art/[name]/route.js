import { readArt, parseArtName, MIME_BY_EXT } from "@/lib/events/art";

/* Serves AI-generated invitation background art.

   PUBLIC on purpose, and it needs to be: this is the background of a guest's
   invitation, and guests have no session. `/api` is already outside the
   proxy.js matcher, so no auth gate applies here — that is deliberate, not an
   oversight. The id is a UUID, the response is a decorative image, and nothing
   about an event, a guest or an RSVP can be inferred from it.

   Immutable caching is safe because the filename never changes contents: a
   regenerated background is a new UUID, never an overwrite. */
export async function GET(_request, ctx) {
  const { name } = await ctx.params;
  const parsed = parseArtName(name);
  if (!parsed) return new Response("Not found", { status: 404 });

  const bytes = readArt(parsed.id, parsed.ext);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(bytes, {
    headers: {
      "Content-Type": MIME_BY_EXT[parsed.ext] || "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

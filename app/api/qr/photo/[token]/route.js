import { getPhotoByToken } from "@/lib/qr/queries";
import { readPhoto } from "@/lib/qr/assets";
import { parseToken } from "@/lib/qr/tokens";

/* Serves a family's generated event picture.

   Keyed on the PASS TOKEN, not on a photo id: the token is the family's
   credential, it is already the thing that unlocks their pass, and it is
   unguessable. A sequential or leaked photo id would otherwise let anyone walk
   the whole event's pictures — which are photographs of children.

   No session: the family has no portal account. `robots` cannot reach this,
   and the URL only exists inside their own pass. */
export async function GET(_request, ctx) {
  const { token: raw } = await ctx.params;
  const token = parseToken(raw);
  if (!token) return new Response("Not found", { status: 404 });

  const photo = getPhotoByToken(token);
  if (!photo || photo.status !== "ready" || !photo.file_name) {
    return new Response("Not found", { status: 404 });
  }

  const bytes = readPhoto(photo.file_name);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(bytes, {
    headers: {
      "Content-Type": photo.mime || "image/png",
      // Private, and never handed to a shared cache — one family's picture
      // must not be served to the next request that happens to share a proxy.
      "Cache-Control": "private, max-age=3600",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

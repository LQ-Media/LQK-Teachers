import { getSession } from "@/lib/session";
import { getAsset } from "@/lib/qr/queries";
import { readTemplate } from "@/lib/qr/assets";

/* Serves a template image (background, logo, detail strip) from the persistent
   volume for the studio's preview.

   Admin-gated: this is Karim's artwork, and sponsors in particular tend to care
   where their logo turns up. The proxy does not cover /api, so the check has to
   be here. */
export async function GET(_request, ctx) {
  const session = await getSession();
  if (session?.role !== "admin") return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const asset = getAsset(id);
  if (!asset) return new Response("Not found", { status: 404 });

  const bytes = readTemplate(asset.file_name);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(bytes, {
    headers: {
      "Content-Type": asset.mime,
      "Cache-Control": "private, max-age=300",
    },
  });
}

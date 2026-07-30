import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { AVATAR_DIR, AVATAR_CONTENT_TYPE, isLocalAvatar, isExternalAvatar } from "@/lib/avatar";

// Serves a teacher's uploaded profile photo from the persistent volume.
// Session-gated (the proxy does not cover /api). External photo URLs from the
// Sheet import are handled directly in the page, so this only serves local files.
export async function GET(_request, ctx) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const row = getDb().prepare("SELECT photo FROM profiles WHERE id = ?").get(id);
  const photo = row?.photo;

  if (isExternalAvatar(photo)) {
    return Response.redirect(photo, 307);
  }
  if (!isLocalAvatar(photo)) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(AVATAR_DIR, photo);
  if (!existsSync(filePath)) return new Response("Not found", { status: 404 });

  const ext = photo.split(".").pop().toLowerCase();
  const bytes = readFileSync(filePath);
  return new Response(bytes, {
    headers: {
      "Content-Type": AVATAR_CONTENT_TYPE[ext] || "application/octet-stream",
      "Cache-Control": "private, max-age=60",
    },
  });
}

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { CERT_DIR, CERT_CONTENT_TYPE, isCertFile } from "@/lib/certs";

// Serves an uploaded certificate from the persistent volume.
//
// Deliberately narrower than the avatar route: a certificate is a personal
// document, so only its owner and an admin (who has to see it to approve it) can
// fetch the file. Colleagues see the verified badge — name, issuer, date — but
// never the scan itself.
export async function GET(_request, ctx) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const cert = getDb()
    .prepare("SELECT teacher_id, image_path FROM certifications WHERE id = ?")
    .get(id);
  if (!cert) return new Response("Not found", { status: 404 });

  const isOwner = cert.teacher_id === session.userId;
  if (!isOwner && session.role !== "admin") return new Response("Forbidden", { status: 403 });
  if (!isCertFile(cert.image_path)) return new Response("Not found", { status: 404 });

  const filePath = path.join(CERT_DIR, cert.image_path);
  if (!existsSync(filePath)) return new Response("Not found", { status: 404 });

  const ext = cert.image_path.split(".").pop().toLowerCase();
  return new Response(readFileSync(filePath), {
    headers: {
      "Content-Type": CERT_CONTENT_TYPE[ext] || "application/octet-stream",
      "Cache-Control": "private, max-age=60",
    },
  });
}

import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";

// GET /api/assessments/evidence/<id>  → 302 to the file on Drive.
//
// The gate is here, not on Drive: the folder is shared to admins' Google
// accounts only, and the portal stores the file id. The uploading assessor
// and admins may open it (decision 19); the teacher it is about never can.
// If the viewer's Google account is not on the folder, Drive itself will ask
// for access — that request goes to Karim, which is the right place.
export async function GET(_request, ctx) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  const { evidenceId } = await ctx.params;
  const row = getDb()
    .prepare("SELECT uploaded_by, drive_file_id, drive_url, kind FROM assessment_evidence WHERE id = ?")
    .get(String(evidenceId));
  if (!row) return new Response("Not found", { status: 404 });

  const allowed = session.role === "admin" || row.uploaded_by === session.userId;
  if (!allowed) return new Response("Forbidden", { status: 403 });

  const url = row.drive_url || `https://drive.google.com/file/d/${encodeURIComponent(row.drive_file_id)}/view`;
  return Response.redirect(url, 302);
}

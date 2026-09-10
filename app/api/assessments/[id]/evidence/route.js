import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/session";
import { canAssessFor } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { driveConfigured, uploadFile } from "@/lib/events/drive";
import { MAX_EVIDENCE_BYTES, MAX_THUMB_CHARS, kindForMime } from "@/lib/assess/evidence";
import { isCriterionKey } from "@/lib/assess/rubric";

// POST /api/assessments/<id>/evidence
//   FormData: file = Blob, label?, criterion_key?, thumb? (data: URL from the device)
//
// A route handler rather than a server action: actions cap the body at
// 10 MB (next.config.mjs) and a lesson clip is several times that. The file
// goes straight to Karim's Drive through the Apps Script and is dropped when
// this returns — nothing is written to the volume, which has no room for video.
//
// `/api` is outside the page proxy, so this gates on the session itself.
export async function POST(request, ctx) {
  const session = await getSession();
  if (!session?.userId) return json({ ok: false, error: "Not signed in." }, 401);
  if (!canAssessFor(session)) return json({ ok: false, error: "Not an assessor." }, 403);

  const { id } = await ctx.params;
  const db = getDb();
  const a = db.prepare("SELECT id, assessor_id, teacher_id, year, status FROM assessments WHERE id = ?").get(String(id));
  if (!a) return json({ ok: false, error: "Assessment not found." }, 404);
  if (a.assessor_id !== session.userId) return json({ ok: false, error: "Only the assessor who opened this can add evidence." }, 403);
  if (a.status !== "draft") return json({ ok: false, error: "This assessment has been submitted." }, 409);

  if (!driveConfigured()) {
    return json({ ok: false, error: "Evidence uploads aren't set up yet — Drive is not configured on the server." }, 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "That upload could not be read. Please try again." }, 400);
  }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    return json({ ok: false, error: "No file was attached." }, 400);
  }
  const kind = kindForMime(file.type);
  if (!kind) return json({ ok: false, error: "Use a video (MP4, MOV, WebM) or a photo (JPEG, PNG, WebP)." }, 415);
  if (file.size > MAX_EVIDENCE_BYTES) {
    return json({ ok: false, error: "That clip is over 45 MB. Record shorter clips, three to four minutes each, and upload them one by one." }, 413);
  }

  const label = String(form.get("label") || "").trim().slice(0, 120);
  const criterionRaw = String(form.get("criterion_key") || "").trim();
  const criterionKey = isCriterionKey(criterionRaw) ? criterionRaw : null;
  let thumb = String(form.get("thumb") || "");
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(thumb) || thumb.length > MAX_THUMB_CHARS) thumb = "";

  const teacher = db.prepare("SELECT full_name FROM profiles WHERE id = ?").get(a.teacher_id);
  const ext = extFor(file.type);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safe(teacher?.full_name)}__${a.id.slice(0, 8)}__${kind}__${stamp}.${ext}`;
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const up = await uploadFile({
    base64,
    mime: file.type,
    filename,
    folderId: process.env.LQK_ASSESS_DRIVE_FOLDER_ID || null,
    subfolder: `Assessments/${a.year}/${safe(teacher?.full_name, " ")}`,
  });
  if (!up.ok) return json({ ok: false, error: `Drive refused the upload: ${up.error}` }, 502);

  const row = {
    id: randomUUID(),
    kind,
    label,
    criterionKey: criterionKey || "",
    mime: file.type,
    bytes: file.size,
    thumb,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO assessment_evidence (id, assessment_id, uploaded_by, kind, label, criterion_key, drive_file_id, drive_url, mime, bytes, thumb, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, a.id, session.userId, kind, label || null, criterionKey, up.fileId, up.url || null, file.type, file.size, thumb || null, row.createdAt);

  return json({ ok: true, evidence: { ...row, uploaderName: session.fullName, canOpen: true } });
}

function extFor(mime) {
  return (
    {
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
      "video/3gpp": "3gp",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
    }[mime] || "bin"
  );
}

function safe(s, space = "-") {
  return (
    String(s || "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, space)
      .slice(0, 40) || "Teacher"
  );
}

function json(body, status) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

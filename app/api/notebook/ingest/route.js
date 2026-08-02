import { getSession } from "@/lib/session";
import { transcribeAudio, extractImageText, MAX_AUDIO_BYTES } from "@/lib/ai/provider";

// POST /api/notebook/ingest
//   FormData: kind = "audio" | "image", file = Blob, language = auto|ms|en|ar
//
// Turns a recording or a photographed page into plain text. Nothing is stored:
// the upload is streamed to the provider and dropped when this handler returns,
// so no audio or image ever lands on the server's disk. Only the text the
// teacher then chooses to save is persisted.
//
// `/api` is excluded from the proxy matcher, so this gates on the session
// itself — same as the hours CSV export.
export async function POST(request) {
  const session = await getSession();
  if (!session?.userId) return json({ ok: false, error: "Not signed in." }, 401);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "That upload could not be read. Please try again." }, 400);
  }

  const kind = String(form.get("kind") || "");
  const file = form.get("file");

  if (!file || typeof file.arrayBuffer !== "function") {
    return json({ ok: false, error: "No file was attached." }, 400);
  }

  if (kind === "audio") {
    if (file.size > MAX_AUDIO_BYTES) {
      return json(
        { ok: false, error: "That recording is too long to send in one piece. Record in shorter sittings — under about 90 minutes each." },
        413
      );
    }
    const result = await transcribeAudio(file, { language: String(form.get("language") || "auto") });
    return json(result, result.ok ? 200 : 502);
  }

  if (kind === "image") {
    const result = await extractImageText(file);
    return json(result, result.ok ? 200 : 502);
  }

  return json({ ok: false, error: "Unknown upload type." }, 400);
}

function json(body, status) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

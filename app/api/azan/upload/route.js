import { getSession } from "@/lib/session";
import {
  addCustomSound,
  deleteCustomSound,
  listCustomSounds,
  MAX_AZAN_BYTES,
  AZAN_EXT_BY_TYPE,
} from "@/lib/azan/store";

const MAX_CUSTOM_SOUNDS = 10;

// POST multipart form-data: file (audio) + label. Returns the new sound.
export async function POST(request) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return Response.json({ error: "No audio file received." }, { status: 400 });
  }

  const ext = AZAN_EXT_BY_TYPE[file.type];
  if (!ext) {
    return Response.json({ error: "Unsupported format — please upload an MP3, M4A, OGG or WAV file." }, { status: 400 });
  }
  if (file.size > MAX_AZAN_BYTES) {
    return Response.json(
      { error: `File is too large (max ${Math.round(MAX_AZAN_BYTES / 1024 / 1024)} MB).` },
      { status: 400 }
    );
  }
  if (listCustomSounds(session.userId).length >= MAX_CUSTOM_SOUNDS) {
    return Response.json({ error: `You can keep up to ${MAX_CUSTOM_SOUNDS} custom sounds — delete one first.` }, { status: 400 });
  }

  const rawLabel = String(form.get("label") || "").trim();
  const label = (rawLabel || file.name || "My azan").slice(0, 60);

  const bytes = Buffer.from(await file.arrayBuffer());
  const sound = addCustomSound(session.userId, label, ext, bytes);
  return Response.json({ sound: { id: sound.id, label: sound.label } });
}

// DELETE ?id=<uuid> — removes the user's own custom sound (file + row).
export async function DELETE(request) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Bad request", { status: 400 });

  const ok = deleteCustomSound(session.userId, id);
  return ok ? Response.json({ ok: true }) : new Response("Not found", { status: 404 });
}

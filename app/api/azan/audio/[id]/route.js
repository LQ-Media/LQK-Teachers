import { statSync, existsSync, createReadStream, readFileSync } from "node:fs";
import { getSession } from "@/lib/session";
import { getCustomSound, customSoundPath, AZAN_CONTENT_TYPE } from "@/lib/azan/store";

// Serves a user's own uploaded azan audio from the persistent volume.
// Supports single-range requests because Safari probes audio with
// `Range: bytes=0-1` and refuses to play sources that ignore it.
export async function GET(request, ctx) {
  const session = await getSession();
  if (!session?.userId) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const row = getCustomSound(id);
  if (!row || row.teacher_id !== session.userId) return new Response("Not found", { status: 404 });

  const filePath = customSoundPath(row.id, row.ext);
  if (!existsSync(filePath)) return new Response("Not found", { status: 404 });

  const size = statSync(filePath).size;
  const contentType = AZAN_CONTENT_TYPE[row.ext] || "application/octet-stream";
  const range = request.headers.get("range");

  const baseHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match && (match[1] !== "" || match[2] !== "")) {
    let start = match[1] === "" ? size - Number(match[2]) : Number(match[1]);
    let end = match[1] !== "" && match[2] !== "" ? Number(match[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = createReadStream(filePath, { start, end });
    return new Response(nodeStreamToWeb(stream), {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new Response(readFileSync(filePath), {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}

function nodeStreamToWeb(stream) {
  return new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
    cancel() {
      stream.destroy();
    },
  });
}

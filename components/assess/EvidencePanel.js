"use client";

import { useRef, useState, useTransition } from "react";
import { deleteEvidence } from "@/lib/actions/assess";
import { MAX_EVIDENCE_BYTES, formatBytes, kindForMime } from "@/lib/assess/evidence";
import Icon from "@/components/Icon";

const field =
  "bg-paper border-[0.5px] border-line rounded-control px-[11px] py-[9px] text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink";

/**
 * Video clips and photos for a domain. Uploads go to Drive through the route
 * handler with a progress bar (XHR, because fetch has no upload progress),
 * one clip at a time so a failed one can be retried on its own.
 *
 * A thumbnail is made on the device before sending — a frame of the video
 * or a downsized photo — so the list renders without touching Drive.
 */
export default function EvidencePanel({ assessmentId, domainKey, kinds, criteria, items: initialItems, editable, isAdmin }) {
  const [items, setItems] = useState(initialItems);
  const [label, setLabel] = useState("");
  const [criterionKey, setCriterionKey] = useState("");
  const [progress, setProgress] = useState(null); // null | 0..100
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const input = useRef(null);

  const accept = kinds.includes("video") ? "video/*,image/*" : "image/*";

  async function pick(file) {
    setError("");
    if (!file) return;
    const kind = kindForMime(file.type);
    if (!kind) {
      setError("Use a video (MP4, MOV, WebM) or a photo (JPEG, PNG, WebP).");
      return;
    }
    if (!kinds.includes(kind)) {
      setError(kind === "video" ? "This domain takes photos only." : "This domain takes video only.");
      return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. Keep each clip under 45 MB — three to four minutes of phone video — and upload the rest as another clip.`);
      return;
    }
    let thumb = "";
    try {
      thumb = kind === "video" ? await videoFrame(file) : await photoThumb(file);
    } catch {
      thumb = "";
    }
    const data = new FormData();
    data.append("file", file);
    data.append("label", label);
    data.append("criterion_key", criterionKey);
    if (thumb) data.append("thumb", thumb);

    setProgress(0);
    try {
      const res = await upload(`/api/assessments/${assessmentId}/evidence`, data, setProgress);
      if (!res.ok) throw new Error(res.error || "Upload failed.");
      setItems((list) => [...list, res.evidence]);
      setLabel("");
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  function remove(e) {
    if (!confirm(`Remove "${e.label || e.kind}"? The file stays on Drive; the portal forgets it.`)) return;
    startTransition(async () => {
      const r = await deleteEvidence(e.id);
      if (r?.error) {
        alert(r.error);
        return;
      }
      setItems((list) => list.filter((x) => x.id !== e.id));
    });
  }

  return (
    <div className="border-t-[0.5px] border-line bg-paper/60 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-heading text-[13px] font-bold text-charcoal">
          Evidence
          {items.length ? <span className="ml-1.5 text-[11px] font-normal text-charcoal-soft">{items.length}</span> : null}
        </h3>
        <p className="text-[11px] text-charcoal-soft">
          {kinds.includes("video") ? "Clips up to 45 MB each, several per lesson. Frame the teacher." : "Photos of the room and the shelf."}
        </p>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-control border-[0.5px] border-line bg-white p-2">
              <Thumb e={e} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold text-charcoal">{e.label || (e.kind === "video" ? "Video clip" : "Photo")}</div>
                <div className="text-[11px] text-charcoal-soft">
                  {e.criterionKey ? `${e.criterionKey} · ` : ""}
                  {e.kind} · {formatBytes(e.bytes)}
                  {e.uploaderName && !editable ? ` · ${e.uploaderName}` : ""}
                </div>
              </div>
              {e.canOpen && (
                <a
                  href={`/api/assessments/evidence/${e.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-charcoal-soft hover:bg-paper-deep hover:text-charcoal"
                  aria-label="Open on Drive"
                  title="Open on Drive"
                >
                  <Icon name={e.kind === "video" ? "play" : "image"} size={14} />
                </a>
              )}
              {(editable || isAdmin) && (
                <button
                  type="button"
                  onClick={() => remove(e)}
                  disabled={pending}
                  className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-charcoal-soft hover:bg-rust-soft hover:text-rust disabled:opacity-40"
                  aria-label="Remove"
                  title="Remove"
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className={`${field} min-w-0 flex-1`}
            placeholder="Label, e.g. opening songs (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={progress !== null}
          />
          <select className={field} value={criterionKey} onChange={(e) => setCriterionKey(e.target.value)} disabled={progress !== null}>
            <option value="">Whole domain {domainKey}</option>
            {criteria.map((c) => (
              <option key={c.key} value={c.key}>
                {c.key} · {c.name}
              </option>
            ))}
          </select>
          <input
            ref={input}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={progress !== null}
            className="flex items-center gap-2 rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-60"
          >
            <Icon name="upload" size={15} />
            {progress === null ? "Add file" : progress < 100 ? `Uploading ${progress}%` : "Saving…"}
          </button>
        </div>
      )}
      {progress !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-paper-deep">
          <div className="h-full bg-gold transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <p className="mt-2 rounded-control bg-rust-soft px-3 py-2 text-[12px] font-medium text-rust">{error}</p>}
    </div>
  );
}

function Thumb({ e }) {
  return (
    <span className="flex h-12 w-16 flex-none items-center justify-center overflow-hidden rounded-[8px] bg-paper-deep text-charcoal-soft">
      {e.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.thumb} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name={e.kind === "video" ? "play" : "image"} size={18} />
      )}
    </span>
  );
}

function upload(url, data, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload. Check the connection and try again."));
    xhr.send(data);
  });
}

// A JPEG data URL, at most ~320px on the long side, from a photo file.
function photoThumb(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      try {
        resolve(drawThumb(img, img.naturalWidth, img.naturalHeight));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(src);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("no thumb"));
    };
    img.src = src;
  });
}

// One frame from about a second in, so it is not the black first frame.
function videoFrame(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const fail = () => {
      URL.revokeObjectURL(src);
      reject(new Error("no thumb"));
    };
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, Math.max(0, (video.duration || 0) / 4));
    };
    video.onseeked = () => {
      try {
        resolve(drawThumb(video, video.videoWidth, video.videoHeight));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(src);
      }
    };
    video.onerror = fail;
    video.src = src;
  });
}

function drawThumb(source, w, h) {
  const max = 320;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

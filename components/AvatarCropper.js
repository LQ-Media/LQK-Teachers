"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import {
  centredOffset,
  clampOffset,
  clampZoom,
  displaySize,
  offsetForZoom,
  sourceRect,
  ZOOM_MAX,
} from "@/lib/avatar-crop";

// Square output, big enough for a retina 80px avatar many times over while
// keeping the upload tiny (~60–150 KB as JPEG).
const OUTPUT_SIZE = 512;
const VIEWPORT = 260; // on-screen crop area, px

/**
 * Pan-and-zoom cropper for profile photos.
 *
 * Why this exists twice over: it lets a teacher line their face up inside the
 * circle whatever shape the original photo is, AND it means the file we upload is
 * always a small 512×512 JPEG rather than the raw camera image — which is what
 * kept the 1 MB Server Action body limit from rejecting ordinary phone photos.
 *
 * The canvas draws from the SAME <img> element used for the preview, so EXIF
 * orientation and any browser quirks apply identically to both: what you see in
 * the circle is exactly what gets saved.
 *
 * The caller gives this a `key` derived from the file, so picking a different
 * photo remounts it and the zoom/offset reset themselves.
 *
 * @param {object} props
 * @param {File} props.file          the picked image
 * @param {(blob: Blob) => void} props.onConfirm  receives the cropped JPEG
 * @param {() => void} props.onCancel
 */
export default function AvatarCropper({ file, onConfirm, onCancel }) {
  const [nat, setNat] = useState(null); // { w, h } natural size
  const [zoom, setZoom] = useState(1); // multiplier on top of cover-fit
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // image top-left vs viewport
  const [busy, setBusy] = useState(false);
  const imgRef = useRef(null);
  const drag = useRef(null);
  const pinch = useRef(null);

  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const shown = nat ? displaySize(nat.w, nat.h, VIEWPORT, zoom) : { scale: 1, width: 0, height: 0 };
  const dw = shown.width;
  const dh = shown.height;

  const clamp = useCallback((o) => clampOffset(o, dw, dh, VIEWPORT), [dw, dh]);

  function onLoad(e) {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    setNat({ w, h });
    setOffset(centredOffset(w, h, VIEWPORT));
  }

  function applyZoom(next) {
    const z = clampZoom(next);
    if (!nat) return setZoom(z);
    setOffset(offsetForZoom(offset, nat.w, nat.h, VIEWPORT, zoom, z));
    setZoom(z);
  }

  // ---- Pointer handling: one finger pans, two fingers pinch ----
  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pts = (pinch.current?.points ?? new Map());
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = { points: pts };
    if (pts.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, start: offset };
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch.current.startDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinch.current.startZoom = zoom;
      drag.current = null;
    }
  }

  function onPointerMove(e) {
    const pts = pinch.current?.points;
    if (!pts?.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.size >= 2 && pinch.current.startDist) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      applyZoom(pinch.current.startZoom * (dist / pinch.current.startDist));
      return;
    }
    if (!drag.current) return;
    setOffset(
      clamp({
        x: drag.current.start.x + (e.clientX - drag.current.x),
        y: drag.current.start.y + (e.clientY - drag.current.y),
      })
    );
  }

  function onPointerUp(e) {
    pinch.current?.points?.delete(e.pointerId);
    drag.current = null;
    if (pinch.current) pinch.current.startDist = null;
  }

  function onWheel(e) {
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  // Nudge with the keyboard so this is usable without a pointer.
  function onKeyDown(e) {
    const step = e.shiftKey ? 20 : 6;
    const moves = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (moves[e.key]) {
      e.preventDefault();
      setOffset((o) => clamp({ x: o.x + moves[e.key].x, y: o.y + moves[e.key].y }));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      applyZoom(zoom * 1.15);
    } else if (e.key === "-") {
      e.preventDefault();
      applyZoom(zoom / 1.15);
    }
  }

  /** Render the visible circle's square bounds to a canvas and hand back a JPEG. */
  async function confirm() {
    const img = imgRef.current;
    if (!img || !nat) return;
    setBusy(true);
    try {
      const src = sourceRect(offset, nat.w, nat.h, VIEWPORT, zoom);

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, src.x, src.y, src.size, src.size, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      if (blob) onConfirm(blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-card border-[0.5px] border-line bg-paper p-4">
      <p className="mb-3 text-[12px] text-charcoal-soft">
        Drag to move your face into the circle, and zoom to fit. Only what shows inside the circle is
        saved.
      </p>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* Crop stage */}
        <div
          role="application"
          aria-label="Reposition your photo — drag to move, arrow keys to nudge, plus and minus to zoom"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          className="relative flex-none cursor-grab touch-none overflow-hidden rounded-card bg-paper-deep outline-none active:cursor-grabbing focus-visible:ring-[1.5px] focus-visible:ring-ink"
          style={{ width: VIEWPORT, height: VIEWPORT }}
        >
          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={url}
              alt=""
              onLoad={onLoad}
              draggable={false}
              className="absolute left-0 top-0 max-w-none select-none"
              style={{
                width: dw || undefined,
                height: dh || undefined,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                visibility: nat ? "visible" : "hidden",
              }}
            />
          )}

          {/* Circular mask: everything outside the circle is dimmed. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background: "rgba(110, 66, 87, 0.55)",
              WebkitMaskImage: `radial-gradient(circle at 50% 50%, transparent 0 ${VIEWPORT / 2 - 1}px, #000 ${VIEWPORT / 2}px)`,
              maskImage: `radial-gradient(circle at 50% 50%, transparent 0 ${VIEWPORT / 2 - 1}px, #000 ${VIEWPORT / 2}px)`,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/70"
          />
        </div>

        {/* Controls + live preview at true size */}
        <div className="flex w-full flex-col gap-4">
          <div>
            <label
              htmlFor="avatar-zoom"
              className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-charcoal"
            >
              Zoom
              <span className="font-normal text-charcoal-soft">{zoom.toFixed(1)}×</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-charcoal-soft">
                <Icon name="minus" size={14} />
              </span>
              <input
                id="avatar-zoom"
                type="range"
                min="1"
                max={ZOOM_MAX}
                step="0.02"
                value={zoom}
                onChange={(e) => applyZoom(Number(e.target.value))}
                className="h-1.5 w-full flex-1 cursor-pointer appearance-none rounded-pill bg-line accent-gold"
              />
              <span className="text-charcoal-soft">
                <Icon name="plus" size={14} />
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <PreviewDot url={url} dw={dw} dh={dh} offset={offset} size={56} />
            <PreviewDot url={url} dw={dw} dh={dh} offset={offset} size={28} />
            <span className="text-[11px] text-charcoal-soft">How it will look</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy || !nat}
              className="rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep disabled:opacity-50"
            >
              {busy ? "Preparing…" : "Use this photo"}
            </button>
            <button
              type="button"
              onClick={() => applyZoom(1)}
              className="rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal-soft hover:text-charcoal"
            >
              Reset zoom
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-[12px] font-semibold text-charcoal-soft hover:text-rust"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The same crop shown at a real avatar size, so the choice is judged honestly. */
function PreviewDot({ url, dw, dh, offset, size }) {
  const k = size / VIEWPORT;
  return (
    <span
      className="relative block flex-none overflow-hidden rounded-full bg-paper-deep"
      style={{ width: size, height: size }}
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          draggable={false}
          className="absolute left-0 top-0 max-w-none select-none"
          style={{
            width: dw * k || undefined,
            height: dh * k || undefined,
            transform: `translate(${offset.x * k}px, ${offset.y * k}px)`,
          }}
        />
      )}
    </span>
  );
}

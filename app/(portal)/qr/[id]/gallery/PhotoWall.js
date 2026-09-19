"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { partyName } from "@/lib/qr/tokens";
import { deletePhotoAction } from "../actions";

/* The wall of family pictures, and the slideshow it turns into.

   The slideshow exists to be projected — dropped into a screen in the hall, or
   screen-shared into someone else's deck. So it goes properly fullscreen,
   drives itself, and answers to the arrow keys and the space bar, which is
   what anyone standing at a laptop will reach for. */

const SLIDE_MS = 6000;

// Every image URL carries its photo id. The photo route is served with a long
// max-age because these are 1–2 MB files, so an unversioned URL would hand
// back a regenerated family's OLD picture out of the browser cache.
const srcFor = (photo) => `/api/qr/photo/${photo.token}?v=${photo.id}`;

export default function PhotoWall({ eventId, eventTitle, photos, canDelete }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);

  const count = photos.length;
  const step = useCallback(
    (delta) => setIndex((i) => (count ? (i + delta + count) % count : 0)),
    [count],
  );

  /* Autoplay. Paused when the tab is hidden — a slideshow left running on a
     background tab is pure work for a laptop that is also driving a projector. */
  useEffect(() => {
    if (!playing || count < 2) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") step(1);
    }, SLIDE_MS);
    return () => clearInterval(timer);
  }, [playing, count, step]);

  useEffect(() => {
    if (!playing) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setPlaying(false);
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === " ") {
        // Space is "hold on that one" — the reflex when someone in the room
        // says "wait, go back".
        event.preventDefault();
        setPlaying(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, step]);

  const current = photos[index];

  if (playing && current) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.id}
          src={srcFor(current)}
          alt={partyName(current)}
          /* A key change remounts the <img>, so the fade runs per slide. Kept
             short and opacity-only: this is on a wall behind people who are
             talking, and anything that moves pulls the room's eyes to it. */
          className="lqk-slide-in min-h-0 flex-1 object-contain"
        />

        <div className="flex items-center justify-between gap-4 px-6 py-4 text-white/80">
          <span className="min-w-0 truncate text-lg font-semibold">{partyName(current)}</span>
          <span className="flex-shrink-0 tabular-nums text-sm">
            {index + 1} / {count}
          </span>
        </div>

        {/* Controls sit over the image rather than in a bar, so nothing but the
            picture is on screen when the mouse is still. */}
        <div className="absolute inset-x-0 bottom-20 flex items-center justify-center gap-3 opacity-0 transition-opacity duration-200 ease-out focus-within:opacity-100 hover:opacity-100">
          {[
            ["Previous picture", "chevron-left", () => step(-1)],
            ["Stop the slideshow", "x", () => setPlaying(false)],
            ["Next picture", "chevron-right", () => step(1)],
          ].map(([label, icon, onClick]) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              aria-label={label}
              className="flex h-12 w-12 items-center justify-center rounded-pill bg-white/15 text-white backdrop-blur transition-transform duration-150 ease-out active:scale-[0.95]"
            >
              <Icon name={icon} size={20} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal">Family pictures</h1>
          <p className="mt-0.5 text-sm text-charcoal-soft">
            {eventTitle} · {count} picture{count === 1 ? "" : "s"}
          </p>
        </div>
        {count ? (
          <button
            type="button"
            onClick={() => {
              setIndex(0);
              setPlaying(true);
            }}
            className="rounded-pill bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97]"
          >
            Play slideshow
          </button>
        ) : null}
      </div>

      {count === 0 ? (
        <p className="mt-8 rounded-card border border-line bg-white p-6 text-sm text-charcoal-soft">
          No family has made a picture yet. They appear here as soon as one does.
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo, i) => (
            <li key={photo.id} className="rounded-card border border-line bg-white p-2">
              <button
                type="button"
                onClick={() => {
                  setIndex(i);
                  setPlaying(true);
                }}
                className="block w-full transition-transform duration-150 ease-out active:scale-[0.98]"
                aria-label={`Open ${partyName(photo)} full screen`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={srcFor(photo)}
                  alt={partyName(photo)}
                  loading="lazy"
                  className="aspect-square w-full rounded-[10px] bg-paper object-cover"
                />
              </button>
              <p className="mt-2 truncate px-1 text-sm font-semibold text-ink">{partyName(photo)}</p>
              {canDelete ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await deletePhotoAction(eventId, photo.registration_id);
                      router.refresh();
                    })
                  }
                  className="mt-0.5 px-1 text-xs font-semibold text-rust underline"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { parseToken } from "@/lib/events/passport";
import {
  signInBoothAction,
  pickBoothAction,
  changeBoothAction,
  signOutBoothAction,
  awardAction,
} from "./actions";

/* The booth scanner.

   Staff scan the PARENT, not the reverse. A static per-booth QR is a photo
   someone can WhatsApp to a friend who never visited; scanning the family's
   pass cannot be faked, is one tap, and yields real per-booth data. It also
   means one phone per booth instead of one printed code per booth to lose.

   The volunteer signs in once and leaves this open for the whole event, so the
   screen has exactly one job: say what just happened, in a size readable at
   arm's length, and get out of the way. */

const COOLDOWN_MS = 4000;
const btn =
  "rounded-pill bg-ink px-6 py-3.5 text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-50";
const btnQuiet =
  "rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]";
const field =
  "w-full rounded-control border border-line bg-white px-4 py-3.5 text-base text-ink outline-none focus:border-gold";

export default function BoothStation({ events, event, boothId }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /* Deliberately empty, with the first event as a FALLBACK computed on every
     render rather than as the initial state. This component stays mounted
     across a sign-out (the page re-renders with a new `events` prop), and a
     useState initialiser only ever runs once — so seeding it from `events[0]`
     left the id at "" the moment the list arrived late, and every sign-in
     after a sign-out failed with "that event isn't open". */
  const [chosenEvent, setChosenEvent] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState("");
  const [cameraState, setCameraState] = useState("idle"); // idle | live | denied | unsupported

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const lastScanRef = useRef({ token: null, at: 0 });
  const busyRef = useRef(false);

  const booth = event?.booths.find((b) => b.id === boothId) || null;
  const eventId = chosenEvent || events[0]?.id || "";

  /* Submitting a scan.

     Guarded by a ref, not by React state: the decode loop runs many times a
     second and state updates are async, so a state flag would let three frames
     of the same pass through before the first re-render lands. */
  const submit = useCallback((value) => {
    if (busyRef.current) return;
    const token = parseToken(value);
    const now = Date.now();
    // The lens is still pointed at a pass that was just awarded — the family
    // hasn't walked away yet. Ignore it rather than re-firing every frame.
    if (token && lastScanRef.current.token === token && now - lastScanRef.current.at < COOLDOWN_MS) {
      return;
    }
    if (token) lastScanRef.current = { token, at: now };

    busyRef.current = true;
    startTransition(async () => {
      const res = await awardAction(value);
      setResult(res.ok ? res : null);
      setError(res.ok ? null : res.error);
      busyRef.current = false;
    });
  }, []);

  /* The camera.

     Two decoders, because one browser family has neither. BarcodeDetector is
     native, runs off the main thread and is the fast path (Chrome/Android).
     Safari has no BarcodeDetector at all — iOS included, which is most of the
     phones at an LQK event — so jsQR is imported LAZILY there and fed frames
     from a canvas. Lazy so Android never downloads a decoder it won't run. */
  useEffect(() => {
    if (!booth) return undefined;
    let cancelled = false;
    let timer = null;
    let detector = null;
    let jsQR = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("unsupported");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The BACK camera. Without this a phone opens the selfie camera and
          // the volunteer has to hold the pass behind their own head.
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // playsInline or iOS Safari takes the video fullscreen on play and
          // the rest of the screen disappears.
          video.setAttribute("playsinline", "true");
          await video.play().catch(() => {});
        }
        setCameraState("live");

        if ("BarcodeDetector" in window) {
          detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        } else {
          jsQR = (await import("jsqr")).default;
        }

        const tick = async () => {
          if (cancelled) return;
          const video = videoRef.current;
          if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
            try {
              if (detector) {
                const found = await detector.detect(video);
                if (found[0]?.rawValue) submit(found[0].rawValue);
              } else if (jsQR) {
                const canvas = canvasRef.current;
                const width = video.videoWidth;
                const height = video.videoHeight;
                if (canvas && width && height) {
                  canvas.width = width;
                  canvas.height = height;
                  const ctx = canvas.getContext("2d", { willReadFrequently: true });
                  ctx.drawImage(video, 0, 0, width, height);
                  const image = ctx.getImageData(0, 0, width, height);
                  const found = jsQR(image.data, width, height, { inversionAttempts: "dontInvert" });
                  if (found?.data) submit(found.data);
                }
              }
            } catch {
              // A single bad frame is normal (mid-focus, mid-rotation). Keep
              // looping — throwing here would kill the scanner for the day.
            }
          }
          // A timer rather than requestAnimationFrame: rAF is throttled to a
          // stop in a backgrounded tab, and 4–8 decodes a second is plenty for
          // a phone being pointed at a card.
          timer = setTimeout(tick, 160);
        };
        tick();
      } catch {
        if (!cancelled) setCameraState("denied");
      }
    }

    start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [booth, submit]);

  /* ---- sign in ---------------------------------------------------------- */
  if (!event) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-sm px-5 py-12">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">Booth scanner</h1>
        <p className="mt-1.5 text-sm text-charcoal-soft">
          Sign in once on this phone. It stays signed in for the day.
        </p>

        {events.length === 0 ? (
          <p className="mt-8 rounded-control bg-sand px-4 py-3 text-sm text-gold-hover">
            No event has check-in open right now.
          </p>
        ) : (
          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const res = await signInBoothAction(eventId, pin);
                if (res.ok) router.refresh();
                else setError(res.error);
              });
            }}
          >
            {events.length > 1 ? (
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor="event">
                  Event
                </label>
                <select
                  id="event"
                  value={eventId}
                  onChange={(e) => setChosenEvent(e.target.value)}
                  className={field}
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="rounded-control bg-paper-deep px-4 py-3 text-sm font-semibold text-ink">
                {events[0].title}
              </p>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-semibold text-ink" htmlFor="pin">
                Staff PIN
              </label>
              <input
                id="pin"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                className={`${field} text-center font-heading text-2xl tracking-[0.5em]`}
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-control bg-rust-soft px-4 py-3 text-sm text-rust">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending || pin.length < 4 || !eventId}
              className={`${btn} w-full`}
            >
              {pending ? "Checking…" : "Sign in"}
            </button>
          </form>
        )}
      </main>
    );
  }

  /* ---- pick a booth ----------------------------------------------------- */
  if (!booth) {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-sm px-5 py-12">
        <h1 className="font-heading text-2xl font-semibold text-charcoal">Which booth?</h1>
        <p className="mt-1.5 text-sm text-charcoal-soft">{event.title}</p>
        <ul className="mt-6 space-y-3">
          {event.booths.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await pickBoothAction(b.id);
                    if (res.ok) router.refresh();
                    else setError(res.error);
                  })
                }
                className="flex w-full items-center gap-3 rounded-card border border-line bg-white px-4 py-4 text-left transition-transform duration-150 ease-out active:scale-[0.98]"
              >
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control bg-sand font-heading text-xl font-semibold text-gold-hover">
                  {b.letter}
                </span>
                <span className="text-base font-semibold text-ink">{b.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="mt-4 rounded-control bg-rust-soft px-4 py-3 text-sm text-rust">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await signOutBoothAction();
              router.refresh();
            })
          }
          className="mt-8 w-full text-sm text-charcoal-soft underline"
        >
          Sign this phone out
        </button>
      </main>
    );
  }

  /* ---- scan ------------------------------------------------------------- */
  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-heading text-xl font-semibold text-charcoal">{booth.name}</p>
          <p className="text-xs text-charcoal-soft">
            {event.title} · gives the letter {booth.letter}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await changeBoothAction();
              router.refresh();
            })
          }
          className={btnQuiet}
        >
          Change booth
        </button>
      </header>

      <div className="relative mt-5 overflow-hidden rounded-card border border-line bg-ink">
        {/* aspect-square, so the framing box is the same shape on every phone
            and a volunteer learns one gesture. */}
        <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        {cameraState === "live" ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-[18%] rounded-card border-2 border-white/80"
          />
        ) : null}
        {cameraState !== "live" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <Icon name="camera" size={28} className="text-white/70" />
            <p className="text-sm text-white/80">
              {cameraState === "denied"
                ? "No camera access — type the code below instead."
                : cameraState === "unsupported"
                  ? "This browser can’t open the camera. Type the code below."
                  : "Starting the camera…"}
            </p>
          </div>
        ) : null}
      </div>

      {/* The manual field is not a fallback nobody mentions — it is the thing
          that keeps the queue moving when a lens is scratched or the light is
          wrong. Every pass prints its 8 characters for exactly this. */}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(manual);
          setManual("");
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          placeholder="OR TYPE THE CODE"
          aria-label="Pass code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className={`${field} text-center font-heading tracking-[0.25em]`}
        />
        <button type="submit" disabled={pending || !manual.trim()} className={btn}>
          Go
        </button>
      </form>

      <div aria-live="polite" className="mt-4 min-h-[7rem]">
        {error ? (
          <div className="rounded-card bg-rust-soft p-5 text-center">
            <p className="font-heading text-lg font-semibold text-rust">{error}</p>
          </div>
        ) : null}

        {result ? (
          <div
            className={`rounded-card p-5 text-center ${
              result.already ? "bg-paper-deep" : "bg-sand"
            }`}
          >
            {/* Honey surface with ink text, not a big glyph in ink on a gold
                fill — gold (#96681A) is an accent, and that pairing measured
                about 2.4:1. This has to be legible at arm's length in a bright
                hall, which is the whole reason the card exists. */}
            <p className="font-heading text-3xl font-semibold text-ink">
              {result.already ? "Already collected" : result.letter}
            </p>
            <p className="mt-1 text-base font-semibold text-ink">{result.name}</p>
            <p className="mt-0.5 text-sm text-charcoal-soft">
              {result.already
                ? "They’ve been here before — wave them on."
                : `${result.collected} of ${result.total} letters`}
            </p>
            {result.complete && !result.already ? (
              <p className="mt-2 text-sm font-semibold text-gold-hover">
                That’s the last one — send them to the prize counter.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

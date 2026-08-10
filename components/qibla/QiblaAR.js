"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { signedDelta } from "@/lib/qibla";

// Nominal horizontal field of view of a phone's rear camera held in portrait.
// Real values run ~50–60° and are not exposed by getUserMedia, so the marker's
// horizontal placement is approximate by a few degrees — which is why the
// *lock* is decided by the bearing maths (ALIGNED_DEG below), never by whether
// the marker looks centred.
const HFOV_DEG = 55;
const ALIGNED_DEG = 5;

/**
 * Camera view of the Qibla: the live rear camera with a marker drawn over it
 * where the Kaaba lies.
 *
 * Performance is the whole design. `deviceorientation` fires at up to 60Hz and
 * routing each event through React state would re-render the tree (and the
 * video's sibling overlay) on every frame — visibly janky on the mid-range
 * Androids the teachers use. So the heading lands in a ref, one rAF loop writes
 * `transform` and `textContent` directly, and React state changes only when the
 * lock state flips (a handful of times per use). Nothing heavier than a
 * translate is animated, and there is no 3D engine to load.
 */
export default function QiblaAR({ qibla, placeLabel, distanceKm, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const markerRef = useRef(null);
  const arrowRef = useRef(null);
  const degRef = useRef(null);
  const turnRef = useRef(null);
  const headingRef = useRef(null);

  const [error, setError] = useState(null);
  const [compass, setCompass] = useState("idle"); // idle|live|unavailable|denied
  const [aligned, setAligned] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  // --- camera ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot open the camera. Use the dial instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setError(
          e?.name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera for this site, or use the dial instead."
            : "No camera available on this device."
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // --- compass --------------------------------------------------------
  const onOrientation = useCallback((event) => {
    // iOS reports a true compass heading directly; Android gives alpha
    // counter-clockwise from north on ABSOLUTE events only. A relative event
    // is worthless here — it drifts — so it is ignored rather than shown.
    let h = null;
    if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
      h = event.webkitCompassHeading;
    } else if (event.absolute === true && typeof event.alpha === "number") {
      h = 360 - event.alpha;
    }
    if (h === null) return;
    headingRef.current = ((h % 360) + 360) % 360;
    setCompass((s) => (s === "live" ? s : "live"));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const DOE = typeof window !== "undefined" ? window.DeviceOrientationEvent : undefined;
      if (!DOE) {
        setCompass("unavailable");
        return;
      }
      if (typeof DOE.requestPermission === "function") {
        // iOS 13+. This component is only ever mounted from a button tap, so
        // we are still inside the user gesture that iOS requires.
        try {
          const res = await DOE.requestPermission();
          if (res !== "granted") {
            setCompass("denied");
            return;
          }
        } catch {
          setCompass("denied");
          return;
        }
      }
      if (cancelled) return;
      window.addEventListener("deviceorientationabsolute", onOrientation, true);
      window.addEventListener("deviceorientation", onOrientation, true);
      setTimeout(() => {
        if (!cancelled) setCompass((s) => (s === "live" ? s : "unavailable"));
      }, 2500);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
    };
  }, [onOrientation]);

  // --- cues -----------------------------------------------------------
  // One short chime, synthesised rather than loaded: a WebAudio oscillator has
  // no asset to fetch, so the cue still fires with no network — which is the
  // point of the offline mode.
  const audioRef = useRef(null);
  const chime = useCallback(() => {
    if (mutedRef.current) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioRef.current || (audioRef.current = new Ctx());
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      // Two notes, a fifth apart — reads as "found it" rather than as an alarm.
      [880, 1318.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.16, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.3);
      });
    } catch {
      // audio is a nicety; never let it break the finder
    }
  }, []);

  const buzz = useCallback(() => {
    // Android only — iOS Safari has never shipped navigator.vibrate.
    try {
      navigator.vibrate?.([40, 60, 40]);
    } catch {
      // ignore
    }
  }, []);

  // --- the render loop -------------------------------------------------
  // Everything below writes to the DOM directly. See the component note.
  useEffect(() => {
    if (qibla === null || qibla === undefined) return;
    let raf = 0;
    let wasAligned = false;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const heading = headingRef.current;
      const marker = markerRef.current;
      if (heading === null || !marker) return;

      const delta = signedDelta(heading, qibla); // −180…180, + = turn right
      const half = HFOV_DEG / 2;
      const onScreen = Math.abs(delta) <= half;

      // Horizontal placement: linear across the frame is accurate enough at
      // these angles (tan() would matter past ~40° off-axis, where the marker
      // is pinned to the edge anyway).
      const x = Math.max(-1, Math.min(1, delta / half));
      marker.style.transform = `translate3d(calc(-50% + ${(x * 42).toFixed(2)}vw), -50%, 0)`;
      marker.style.opacity = onScreen ? "1" : "0.35";

      if (degRef.current) degRef.current.textContent = `${Math.round(heading)}°`;
      if (turnRef.current) {
        turnRef.current.textContent =
          Math.abs(delta) <= ALIGNED_DEG
            ? "Facing the Qibla"
            : `Turn ${delta > 0 ? "right" : "left"} ${Math.abs(Math.round(delta))}°`;
      }
      if (arrowRef.current) {
        arrowRef.current.style.opacity = onScreen ? "0" : "1";
        arrowRef.current.style.transform = `scaleX(${delta > 0 ? 1 : -1})`;
      }

      const nowAligned = Math.abs(delta) <= ALIGNED_DEG;
      if (nowAligned !== wasAligned) {
        wasAligned = nowAligned;
        setAligned(nowAligned);
        // Edge-triggered: the cue fires when the Qibla is FOUND, not for every
        // frame spent inside the window.
        if (nowAligned) {
          buzz();
          chime();
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [qibla, buzz, chime]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* A wash so white overlay text stays readable against a bright room */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/60" />

      {error ? (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-8 text-center text-[14px] leading-relaxed text-white">
          {error}
        </div>
      ) : (
        <>
          {/* The marker. Absolutely positioned at the centre and moved only by
              transform, so the browser can keep it on the compositor. */}
          <div
            ref={markerRef}
            className={`pointer-events-none absolute left-1/2 top-1/2 will-change-transform ${
              aligned ? "drop-shadow-[0_0_18px_rgba(224,169,59,0.9)]" : ""
            }`}
          >
            <KaabaMarker aligned={aligned} />
          </div>

          {/* Off-screen pointer: which way to turn when the Kaaba is behind you */}
          <div
            ref={arrowRef}
            className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-white/90 opacity-0 transition-opacity"
          >
            <Icon name="chevron-right" size={44} />
          </div>

          {/* Live readout */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-8 text-center text-white">
            <p ref={turnRef} className="font-heading text-[22px] font-bold drop-shadow">
              {compass === "live" ? "" : "Looking for a compass…"}
            </p>
            <p className="mt-1 text-[13px] text-white/80">
              Heading <span ref={degRef} className="font-semibold tabular-nums">—</span> · Qibla{" "}
              <span className="font-semibold tabular-nums">{Math.round(qibla ?? 0)}°</span>
            </p>
            {aligned && (
              <div className="mt-3 inline-flex flex-col items-center gap-1 rounded-card bg-black/55 px-4 py-2.5 backdrop-blur">
                <span className="inline-flex items-center gap-1.5 text-[14px] font-bold text-gold">
                  <Icon name="check" size={16} /> Qibla found
                </span>
                <span className="text-[12px] text-white/85">
                  {placeLabel} · {Math.round(qibla ?? 0)}° from true north
                  {distanceKm ? ` · ${distanceKm.toLocaleString("en-SG")} km to Makkah` : ""}
                </span>
              </div>
            )}
            {compass !== "live" && compass !== "idle" && (
              <p className="mx-auto mt-3 max-w-sm text-[12px] leading-relaxed text-white/75">
                {compass === "denied"
                  ? "Motion & orientation access was blocked, so the marker cannot follow the room. Allow it in your browser settings."
                  : "This device has no compass, so the marker cannot follow the room. Use the dial and a compass app."}
              </p>
            )}
          </div>
        </>
      )}

      {/* Controls */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-pill bg-black/50 px-3.5 py-2 text-[13px] font-semibold text-white backdrop-blur"
        >
          <Icon name="arrow-left" size={15} /> Close
        </button>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-pressed={muted}
          className="flex items-center gap-1.5 rounded-pill bg-black/50 px-3.5 py-2 text-[13px] font-semibold text-white backdrop-blur"
        >
          <Icon name={muted ? "bell-off" : "bell"} size={15} />
          {muted ? "Sound off" : "Sound on"}
        </button>
      </div>
    </div>
  );
}

/**
 * The Kaaba, drawn rather than modelled: an inline SVG costs nothing to
 * animate and is the reason the view stays smooth.
 *
 * Its colours are hard-coded kiswah black and gold, NOT theme tokens — the
 * palette can move underneath this file and the Kaaba still has to come out
 * black and gold (same rule as the dial in QiblaFinder).
 */
function KaabaMarker({ aligned }) {
  return (
    <svg width="96" height="112" viewBox="0 0 96 112" aria-hidden="true">
      {/* Halo — widens and brightens on lock */}
      <circle cx="48" cy="52" r={aligned ? 44 : 38} fill="#E0A93B" opacity={aligned ? 0.28 : 0.14} />
      <circle cx="48" cy="52" r="30" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1.5" />

      {/* The Kaaba: cube in kiswah black with its gold band and door */}
      <rect x="27" y="33" width="42" height="42" rx="2" fill="#141414" />
      <rect x="27" y="33" width="42" height="42" rx="2" fill="none" stroke="#000" strokeOpacity="0.5" />
      <rect x="27" y="45" width="42" height="6" fill="#C9A227" />
      <rect x="55" y="55" width="8" height="20" fill="#C9A227" opacity="0.9" />

      {/* Ground pointer */}
      <path d="M48 96 L40 82 L56 82 Z" fill={aligned ? "#E0A93B" : "#FFFFFF"} opacity="0.95" />
    </svg>
  );
}

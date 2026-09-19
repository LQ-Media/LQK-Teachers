"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  advance,
  cumulative,
  fraction,
  hintAt,
  isComplete,
  levelFor,
  scaleFor,
} from "@/lib/games/trace";
import { buzz, chime, fanfare, nudge, unlockAudio } from "@/lib/games/audio";

/**
 * The tracing surface: one letter, its strokes in order, then its dots.
 *
 * WHAT A CHILD EXPERIENCES
 *
 * The letter sits faint on the page with one stroke lit as a pale road, a dot
 * where the finger goes and an arrow showing which way. As the finger travels
 * the road fills with light behind it and ticks softly, about eight times per
 * stroke — so the hand, the ear and the eye all report the same motion at the
 * same moment, which is the whole point of doing this on a touch screen rather
 * than on paper.
 *
 * Straying off the road stops the light where it was. Nothing flashes red,
 * nothing is scored, and the arrow re-appears pointing the way: the letter
 * simply stops moving, and every child understands that.
 *
 * When the last stroke and any dots are done the even-width trace cross-fades
 * into the real Mirza letterform — the calligraphic shape from the printed
 * flashcard — and the parent is told, via onComplete, to say the letter.
 *
 * ONE POINTER ONLY
 *
 * A tablet resting on a table collects a palm, a sleeve and a second child's
 * finger. The surface locks onto the first pointer that goes down and ignores
 * every other until it lifts, which is the cheapest palm rejection there is
 * and the only one that works the same on every device.
 *
 * KEYED BY LETTER
 *
 * There is no "reset when the letter changes" logic here on purpose. Callers
 * mount this with `key={letterId}`, so a new letter is a new component with
 * fresh state — which is both less code and impossible to get half-right.
 */

// Progress ticks per stroke. Eight is enough to feel continuous under a moving
// finger without turning into a buzz.
const TICKS_PER_STROKE = 8;

/* Sizes a finger cares about, in CSS pixels, converted to viewBox units at the
   size actually rendered. Everything here used to be a bare unit count, which
   silently shrank to half a fingertip on a phone — see the table in
   lib/games/trace.js. As with the tolerances, these are floors: a large screen
   keeps the width it already had.

   ROAD is the pale path being followed; 30px is about two-thirds of a
   fingertip, wide enough to aim at without hiding the letter underneath. TAP
   is the radius of a dot's hit area — 22px makes a 44px target, which is the
   smallest thing a small hand can reliably hit. */
const ROAD_PX = 30;
const TAP_PX = 22;

export default function TraceCanvas({
  letter,
  geometry,
  level = "easy",
  harakah = null,
  onComplete,
  onStrokeDone,
  className = "",
}) {
  const svgRef = useRef(null);
  const glowRef = useRef(null);

  const [strokeIndex, setStrokeIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [strayed, setStrayed] = useState(false);
  const [dotsDone, setDotsDone] = useState([]);
  const [done, setDone] = useState(false);
  const [demo, setDemo] = useState(0);
  const [unitsPerPx, setUnitsPerPx] = useState(1);

  const pointerId = useRef(null);
  const started = useRef(false);
  const ticked = useRef(0);

  /* Progress lives in a ref as well as in state, and the ref is the one the
     maths reads.

     It has to, because several pointer samples can arrive before React
     re-renders — a phone with a busy main thread delivers them in bursts, and
     a single event can carry several coalesced samples. The old code read
     `progress` from state inside the sampler, so every sample in a burst
     advanced from the same stale value and only the furthest one survived.
     Under a fast finger that quietly threw away most of the movement, which is
     part of why the trace felt like it kept catching. */
  const progressRef = useRef(0);
  const strokeRef = useRef(0);
  const frame = useRef(null);

  /* The client→viewBox transform, taken once per gesture instead of once per
     sample. getScreenCTM() forces the browser to flush style and layout, and
     calling it inside every pointermove — up to a couple of hundred times per
     stroke — is work a phone cannot spare. Layout cannot change mid-drag here:
     the game is a fixed, non-scrolling surface. */
  const inverse = useRef(null);

  const rules = useMemo(() => scaleFor(levelFor(level), unitsPerPx), [level, unitsPerPx]);
  const roadWidth = Math.max(58, ROAD_PX * unitsPerPx);
  const tapRadius = TAP_PX * unitsPerPx;

  /* "Again" rather than forcing a child to leave the letter and come back.
     Asking for the same letter twice is the single most common thing a small
     child does, and until this existed the only way to repeat one was to
     navigate away — which also meant the letter never spoke a second time. */
  const again = useCallback(() => {
    setStrokeIndex(0);
    setProgress(0);
    setStrayed(false);
    setDotsDone([]);
    setDone(false);
    started.current = false;
    ticked.current = 0;
    progressRef.current = 0;
    strokeRef.current = 0;
  }, []);

  /* How big the letter actually is, which is what makes the finger-sized
     tolerances above possible. The viewBox is centred and scaled to fit
     (preserveAspectRatio defaults to xMidYMid meet), so the scale is whichever
     axis is the tighter fit. */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const read = () => {
      const box = svg.getBoundingClientRect();
      const vb = svg.viewBox?.baseVal;
      const vbW = vb?.width || 1000;
      const vbH = vb?.height || 1000;
      if (!box.width || !box.height) return;
      const pxPerUnit = Math.min(box.width / vbW, box.height / vbH);
      if (pxPerUnit > 0) setUnitsPerPx(1 / pxPerUnit);
    };
    read();
    // Rotating a tablet changes this, and so does the browser chrome sliding
    // away on a phone.
    const observer = new ResizeObserver(read);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const strokes = useMemo(() => geometry?.strokes ?? [], [geometry]);
  const dots = useMemo(() => geometry?.dots ?? [], [geometry]);

  /* The polylines come from the geometry file already sampled — see the note in
     scripts/huruf-geometry.py — so there is nothing to measure and no effect. */
  const samples = useMemo(
    () => strokes.map((s) => ({ points: s.points, cums: cumulative(s.points) })),
    [strokes],
  );

  const current = samples[strokeIndex] ?? null;
  const total = current ? current.cums[current.cums.length - 1] : 0;

  const strokesDone = strokeIndex >= strokes.length;

  const finish = useCallback(() => {
    setDone(true);
    fanfare();
    buzz([24, 40, 24]);
    onComplete?.();
  }, [onComplete]);

  /* ---------------------------------------------------------------- pointer */

  /* Keep the browser from deciding the trace was a scroll.
   *
   * `touch-action: none` on the surface is the declarative half and is set in
   * the class list below. This is the other half: while a finger is actually
   * tracing, the default action of each touchmove is cancelled outright, which
   * is what stops a phone turning the stroke into a pan or a pull-to-refresh
   * and firing pointercancel at us.
   *
   * It has to be a native listener. React registers touchmove as PASSIVE, and
   * preventDefault() inside a React onTouchMove handler does nothing at all —
   * so this cannot be expressed as a JSX prop.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const block = (e) => {
      if (pointerId.current !== null && e.cancelable) e.preventDefault();
    };
    svg.addEventListener("touchmove", block, { passive: false });
    return () => svg.removeEventListener("touchmove", block);
  }, []);

  /** Take the transform once, at the start of a gesture. */
  const readTransform = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    inverse.current = ctm ? ctm.inverse() : null;
  }, []);

  /** Client coordinates → viewBox coordinates, using the cached matrix. */
  const toViewBox = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return null;
    if (inverse.current) {
      const pt = new DOMPoint(clientX, clientY).matrixTransform(inverse.current);
      return [pt.x, pt.y];
    }
    // Fallback for the rare engine with no CTM: the viewBox is centred and
    // scaled to fit, so the letterboxing can be derived from the box itself.
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox?.baseVal;
    const vbW = vb?.width || 1000;
    const vbH = vb?.height || 1000;
    const s = Math.min(box.width / vbW, box.height / vbH) || 1;
    return [
      (clientX - box.left - (box.width - vbW * s) / 2) / s,
      (clientY - box.top - (box.height - vbH * s) / 2) / s,
    ];
  }, []);

  /* The glow is moved by writing the dash offset straight onto the node, once
     per animation frame, rather than by re-rendering the SVG on every pointer
     sample. Re-rendering meant React reconciling thirty-odd elements — and
     re-rasterising the blur filter — as often as the samples arrived, which on
     a phone is more often than it can paint. The state update still happens,
     so the arrow and the start dot stay right; it just no longer gates how
     promptly the light follows the finger. */
  const paint = useCallback(() => {
    frame.current = null;
    const node = glowRef.current;
    const stroke = samples[strokeRef.current];
    if (node && stroke) {
      const len = stroke.cums[stroke.cums.length - 1];
      node.setAttribute("stroke-dashoffset", String(len - progressRef.current));
    }
    setProgress(progressRef.current);
  }, [samples]);

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  /**
   * One pointer position against the current stroke.
   *
   * Reads and writes progressRef so that a burst of samples chains correctly,
   * and completes a stroke synchronously — completion speaks the letter, and
   * iOS only starts speech inside the gesture that asked for it, so that part
   * must never be deferred to a frame callback.
   */
  const sampleAt = useCallback((p) => {
    const stroke = samples[strokeRef.current];
    if (!stroke || done) return;
    const total = stroke.cums[stroke.cums.length - 1];

    const res = advance({
      points: stroke.points,
      cums: stroke.cums,
      pointer: p,
      progress: progressRef.current,
      level: rules,
      started: started.current,
    });

    if (res.state === "advanced") {
      started.current = true;
      setStrayed(false);

      if (isComplete(res.progress, total, rules)) {
        const finished = strokeRef.current;
        onStrokeDone?.(finished);
        chime({ freq: 880, duration: 0.2, gain: 0.12 });
        buzz(22);
        ticked.current = 0;
        started.current = false;
        progressRef.current = 0;
        strokeRef.current = finished + 1;
        setProgress(0);
        setStrokeIndex(finished + 1);
        // The letter is finished here, in the gesture that finished it, rather
        // than in an effect watching for it — so completion happens once, at a
        // known moment, with the sound it belongs to.
        if (finished + 1 >= strokes.length && dots.length === 0) finish();
        return;
      }

      progressRef.current = res.progress;
      schedule();

      // Tick on the way past each eighth of the stroke: the ear confirms the
      // hand is still doing the right thing without waiting for the end.
      const step = Math.floor(fraction(res.progress, total) * TICKS_PER_STROKE);
      if (step > ticked.current) {
        ticked.current = step;
        chime({ freq: 520 + step * 45, duration: 0.07, gain: 0.07 });
        buzz(8);
      }
      return;
    }

    if ((res.state === "off" || res.state === "wrongStart") && !strayed) {
      setStrayed(true);
      // Only nudge on a real stray mid-stroke; a child hunting for the start
      // dot is not doing anything wrong.
      if (res.state === "off" && progressRef.current > 0) nudge();
    }
  }, [samples, done, rules, strokes.length, dots.length, onStrokeDone, strayed, finish, schedule]);

  /**
   * Every position the event carries, not just the latest.
   *
   * A browser under load merges the touch samples it took since the last frame
   * into one pointermove and hands the intermediate ones to
   * getCoalescedEvents(). Using only the event's own position throws those
   * away, so a quick stroke arrives as a few long jumps instead of a smooth
   * path — and a jump longer than the level's lookAhead reads as leaving the
   * road, which stops the glow on a trace that was perfectly good.
   */
  const sampleEvent = useCallback((e) => {
    /* getCoalescedEvents lives on the NATIVE pointer event. React's synthetic
       event copies a fixed list of properties and does not forward methods, so
       reading it off the synthetic event silently returned undefined and this
       whole path was dead code — every intermediate position the browser had
       already captured was thrown away. */
    const native = e.nativeEvent ?? e;
    const parts = native.getCoalescedEvents ? native.getCoalescedEvents() : null;
    const list = parts && parts.length ? parts : [e];
    for (const part of list) {
      const p = toViewBox(part.clientX, part.clientY);
      if (p) sampleAt(p);
    }
  }, [toViewBox, sampleAt]);

  const acquire = useCallback((e) => {
    pointerId.current = e.pointerId;
    readTransform();
  }, [readTransform]);

  function onPointerDown(e) {
    if (pointerId.current !== null || done) return;
    unlockAudio();
    acquire(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = toViewBox(e.clientX, e.clientY);
    if (p) sampleAt(p);
  }

  /**
   * A moving finger, including one the browser has already given up on.
   *
   * THE PHONE BUG THIS EXISTS FOR
   *
   * A phone fires `pointercancel` as soon as it decides a touch might be a
   * scroll or a system gesture — the finger is still on the glass and still
   * moving, but the gesture is officially over. The surface used to drop the
   * pointer id at that moment and then ignore every later move, so a drag died
   * silently while TAPPING still worked, because each tap is a fresh
   * `pointerdown`. That is exactly how it was reported: "it works if I tap
   * along the path". A big touchscreen never does this, which is why the same
   * code felt fine there.
   *
   * So a move with no gesture in progress re-acquires instead of being thrown
   * away. A touch pointer only moves while it is down, and a mouse reports its
   * held buttons, so "is this finger still pressed" is answerable and there is
   * no risk of a stray hover reviving a finished stroke.
   */
  function onPointerMove(e) {
    if (pointerId.current === null) {
      if (done) return;
      const pressed = e.pointerType === "touch" || e.buttons > 0 || e.pressure > 0;
      if (!pressed) return;
      acquire(e);
    } else if (e.pointerId !== pointerId.current) {
      return;
    }
    sampleEvent(e);
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointerId.current) return;
    pointerId.current = null;
    setStrayed(false);
    // A stroke abandoned part-way keeps its glow: a child who lifts to
    // reposition their hand has not lost their place.
  }

  function tapDot(i) {
    if (!strokesDone || done || dotsDone.includes(i)) return;
    unlockAudio();
    chime({ freq: 990, duration: 0.12, gain: 0.12 });
    buzz(14);
    setDotsDone([...dotsDone, i]);
    if (dotsDone.length + 1 >= dots.length) finish();
  }

  const hint = useMemo(
    () => (current ? hintAt(current.points, current.cums, progress) : null),
    [current, progress],
  );

  const startPoint = strokes[strokeIndex]?.start;

  return (
    /* touch-none on the wrapper as well as the surface: the SVG alone left the
       wrapper at touch-action:auto, so a finger that strayed a pixel off the
       SVG could still start a pan. */
    <div className={`relative touch-none ${className}`}>
      <svg
        ref={svgRef}
        viewBox={geometry?.viewBox ?? "0 0 1000 1000"}
        className="h-full w-full touch-none select-none"
        role="img"
        aria-label={`Trace the letter ${letter?.name ?? ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          {/* The glow. Two blurs stacked — a tight one for the bright core and
              a wide one for the halo — which reads as light rather than as a
              fuzzy edge. */}
          <filter id="lqk-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="9" result="near" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="26" result="far" />
            <feMerge>
              <feMergeNode in="far" />
              <feMergeNode in="near" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* The letter's real shape, faint: the child can always see where they
            are going, and it is the same silhouette that blooms at the end. */}
        <path
          d={geometry?.outline ?? ""}
          className={`transition-opacity duration-700 ${done ? "opacity-0" : "opacity-[0.13]"}`}
          fill="#3B372B"
          pointerEvents="none"
        />

        {/* The road for the current stroke, and the lit trail of the ones
            already done, so progress through a multi-stroke letter shows. */}
        {strokes.map((s, i) => (
          <path
            key={`road-${i}`}
            d={s.d}
            fill="none"
            stroke={i < strokeIndex ? "#F0A41F" : "#E0D2B4"}
            strokeWidth={i < strokeIndex ? roadWidth * 0.8 : roadWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
            className={`transition-opacity duration-300 ${
              done ? "opacity-0" : i <= strokeIndex ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}

        {/* The light that follows the finger. pathLength pins the dash domain
            to the sampled length, so the glow's end sits where the maths thinks
            the finger has reached. */}
        {current && !done && (
          <path
            ref={glowRef}
            // Keyed so a new stroke gets a fresh node rather than inheriting
            // the previous stroke's dash offset for a frame.
            key={`glow-${strokeIndex}`}
            d={strokes[strokeIndex].d}
            fill="none"
            stroke="#F0A41F"
            strokeWidth={roadWidth * 0.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#lqk-glow)"
            pointerEvents="none"
            pathLength={total}
            strokeDasharray={total}
            strokeDashoffset={total - progress}
            /* No CSS transition. The offset is now written every animation
               frame, so a transition would only make the light trail the
               finger by its own duration — which is the lag it was originally
               added to hide, back when updates arrived irregularly. */
          />
        )}

        {/* Where to begin, and which way. Both disappear the moment the child
            is under way and come back if they lose the path. */}
        {!done && startPoint && (progress === 0 || strayed) && (
          <g pointerEvents="none">
            <circle cx={startPoint[0]} cy={startPoint[1]} r="40" fill="#96681A" opacity="0.25">
              <animate attributeName="r" values="34;52;34" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx={startPoint[0]} cy={startPoint[1]} r="24" fill="#96681A" />
          </g>
        )}
        {!done && hint && progress > 0 && strayed && (
          <g
            transform={`translate(${hint.x} ${hint.y}) rotate(${hint.angle})`}
            opacity="0.85"
            pointerEvents="none"
          >
            <path d="M-22 -20 L22 0 L-22 20 Z" fill="#96681A" />
          </g>
        )}

        {/* Dots: tapped, not traced. A dot is placed, and making a child drag a
            two-pixel circle would be a dexterity test, not a reading lesson.
            The hit area is sized in fingertips rather than viewBox units — at
            34 units it was a comfortable target on a tablet and a 25px one on
            a phone, which is well under what a small hand can hit. */}
        {dots.map((d, i) => {
          const tapped = dotsDone.includes(i);
          const live = strokesDone && !tapped && !done;
          return (
            <g key={`dot-${i}`}>
              {live && (
                <circle
                  cx={d.cx}
                  cy={d.cy}
                  r={d.r * 2.1}
                  fill="#96681A"
                  opacity="0.18"
                  pointerEvents="none"
                >
                  <animate
                    attributeName="opacity"
                    values="0.08;0.3;0.08"
                    dur="1.4s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle
                cx={d.cx}
                cy={d.cy}
                r={Math.max(d.r, 34, tapRadius)}
                fill={tapped || done ? "#F0A41F" : "#E0D2B4"}
                // An amber ring while it is waiting, so the dot reads as
                // something to press rather than as part of the letter.
                stroke={live ? "#96681A" : "none"}
                strokeWidth={live ? 8 : 0}
                strokeDasharray={live ? "18 12" : undefined}
                filter={tapped && !done ? "url(#lqk-glow)" : undefined}
                className={live ? "cursor-pointer" : undefined}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  tapDot(i);
                }}
              />
            </g>
          );
        })}

        {/* The bloom: the finished letter in its real calligraphic form.
            pointerEvents is not optional here. This path is painted over the
            whole letter, and an element at opacity 0 is invisible but still
            hit-testable — so before this was set, it silently swallowed every
            tap aimed at a dot, and no dotted letter (15 of the 28) could ever
            be finished. */}
        <path
          d={geometry?.outline ?? ""}
          fill="#96681A"
          pointerEvents="none"
          filter={done ? "url(#lqk-glow)" : undefined}
          className={`transition-all duration-700 ${done ? "opacity-100" : "opacity-0"}`}
          style={{ transformOrigin: "center", transform: done ? "scale(1)" : "scale(0.94)" }}
        />

        {/* A harakah, if the caller wants one shown on the traced body. */}
        {harakah && (
          <text
            x="500"
            y={harakah.above ? 210 : 880}
            textAnchor="middle"
            className="font-mirza"
            pointerEvents="none"
            fontSize="300"
            fill={done ? "#96681A" : "#3B372B"}
            opacity={done ? 1 : 0.35}
          >
            {harakah.mark}
          </text>
        )}

        {/* "Show me" — a marker walking the stroke the way it is written.
            Remounted on each press so the animation replays. */}
        {demo > 0 && current && !done && (
          <circle key={`demo-${demo}`} r="30" fill="#96681A" opacity="0.9" pointerEvents="none">
            <animateMotion dur="2s" fill="freeze" path={strokes[strokeIndex].d} />
          </circle>
        )}
      </svg>

      {/* Deliberately outside the SVG: a real button, focusable, with a hit
          area a teacher can reach without interrupting the child's hand. It is
          also the only way through this screen without a pointer drag, so a
          keyboard or switch user is not simply stuck. */}
      <button
        type="button"
        onClick={() => {
          unlockAudio();
          if (done) again();
          else setDemo((d) => d + 1);
        }}
        className="absolute bottom-1 left-1 rounded-pill bg-white/85 px-3 py-1.5 text-[12px] font-semibold text-charcoal shadow-sm hover:bg-white"
      >
        {done ? "Again" : "Show me"}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { recordReadingHeartbeat } from "@/lib/actions/achievements";
import { HEARTBEAT_SECONDS } from "@/lib/achievements/points";

/**
 * Records that the teacher is actually reading, which is what the Achievements
 * reading streak counts. Renders nothing.
 *
 * Mounted as a sibling of the reader in app/(portal)/quran/page.js rather than
 * inside QuranReader.js, so the reader's own component stays untouched.
 *
 * Rules, all deliberate:
 *  - Only beats while the tab is VISIBLE. A reader left open in a background tab
 *    or behind a locked phone earns nothing.
 *  - Stops after IDLE_LIMIT_MS without a scroll, key, tap, or pointer move, so
 *    leaving the page open on a desk doesn't accrue a streak either.
 *  - The server decides what a beat is worth and caps the day, so nothing here
 *    can inflate a score even if the interval is tampered with.
 */
const IDLE_LIMIT_MS = 2 * 60 * 1000;

export default function ReaderHeartbeat() {
  const lastActive = useRef(0);

  useEffect(() => {
    // Reading is mostly still — scrolling and tapping are the signals of a live
    // reader, and audio playback keeps the page busy on its own.
    const markActive = () => {
      lastActive.current = Date.now();
    };
    markActive();

    const events = ["scroll", "keydown", "pointerdown", "pointermove", "touchstart", "wheel"];
    for (const e of events) window.addEventListener(e, markActive, { passive: true });

    let inFlight = false;
    const beat = async () => {
      if (inFlight) return;
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActive.current > IDLE_LIMIT_MS) return;
      inFlight = true;
      try {
        await recordReadingHeartbeat();
      } catch {
        // Best-effort: a missed beat just means a few seconds uncounted.
      } finally {
        inFlight = false;
      }
    };

    // Credit the first beat almost immediately so a short, genuine visit still
    // reaches the 30-second floor that makes a day count.
    const first = setTimeout(beat, 5000);
    const timer = setInterval(beat, HEARTBEAT_SECONDS * 1000);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, markActive);
    };
  }, []);

  return null;
}

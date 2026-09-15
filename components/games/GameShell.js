"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Icon from "@/components/Icon";
import { hasMusic, startMusic, stopMusic, unlockAudio } from "@/lib/games/audio";

/**
 * The frame every game runs inside: kiosk cover, hold-to-exit, level switch,
 * music toggle.
 *
 * WHY IT COVERS THE PORTAL RATHER THAN LIVING OUTSIDE IT
 *
 * A game is handed to a five-year-old on an unlocked tablet that is signed in
 * to a teachers portal containing every child's records. It is rendered as a
 * fixed full-viewport surface over the portal chrome, so there is no sidebar to
 * wander into and no log-out button to find, while the route stays inside the
 * authenticated layout and needs no separate session handling.
 *
 * WHY EXIT IS A HOLD
 *
 * A tap is something a child does forty times a minute. Leaving the game takes
 * a deliberate three-quarter-second press with visible feedback — long enough
 * that it never happens by accident, short enough that an ustazah never fights
 * it. A tap on it does nothing but show the hint.
 */

const LEVEL_KEY = "lqk_games_level";
const MUSIC_KEY = "lqk_games_music";
const HOLD_MS = 750;

export default function GameShell({ title, subtitle, level, onLevelChange, children }) {
  const router = useRouter();
  const [holding, setHolding] = useState(0);
  const [musicAvailable, setMusicAvailable] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const holdFrom = useRef(null);
  const raf = useRef(null);

  /* Music is only offered when a track is actually installed — see the note in
     lib/games/audio.js on why the repo ships without one. */
  useEffect(() => {
    let live = true;
    hasMusic().then((ok) => live && setMusicAvailable(ok));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => () => stopMusic(), []);

  const toggleMusic = useCallback(() => {
    unlockAudio();
    setMusicOn((on) => {
      if (on) stopMusic();
      else startMusic();
      try {
        localStorage.setItem(MUSIC_KEY, on ? "0" : "1");
      } catch {
        // storage disabled — the toggle still works for this session
      }
      return !on;
    });
  }, []);

  /* ------------------------------------------------------------ hold to exit */

  const stopHold = useCallback(() => {
    holdFrom.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setHolding(0);
  }, []);

  const startHold = useCallback(() => {
    if (holdFrom.current !== null) return;
    holdFrom.current = performance.now();
    const step = () => {
      if (holdFrom.current === null) return;
      const held = (performance.now() - holdFrom.current) / HOLD_MS;
      if (held >= 1) {
        stopHold();
        stopMusic();
        router.push("/games");
        return;
      }
      setHolding(held);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [router, stopHold]);

  // Escape is the grown-up's way out, for a teacher on a laptop.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        stopMusic();
        router.push("/games");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-paper overscroll-none">
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-line bg-white px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          aria-label="Hold to leave the game"
          title="Hold to leave"
          onPointerDown={startHold}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control text-charcoal-soft hover:bg-paper-deep"
        >
          <Icon name="chevron-left" size={20} />
          {holding > 0 && (
            <svg className="pointer-events-none absolute inset-0" viewBox="0 0 40 40">
              <circle
                cx="20"
                cy="20"
                r="17"
                fill="none"
                stroke="#96681A"
                strokeWidth="3"
                strokeLinecap="round"
                pathLength="100"
                strokeDasharray="100"
                strokeDashoffset={100 - holding * 100}
                transform="rotate(-90 20 20)"
              />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-[17px] font-bold leading-tight text-charcoal">{title}</h1>
          {subtitle && <p className="truncate text-[11px] text-charcoal-soft">{subtitle}</p>}
        </div>

        {onLevelChange && (
          <div
            className="flex flex-shrink-0 rounded-pill bg-paper-deep p-0.5"
            role="group"
            aria-label="Difficulty"
          >
            {[
              ["easy", "Easy"],
              ["proper", "Proper"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onLevelChange(id)}
                aria-pressed={level === id}
                className={`rounded-pill px-3 py-1.5 text-[12px] font-bold transition-colors ${
                  level === id ? "bg-white text-ink shadow-sm" : "text-charcoal-soft"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={toggleMusic}
          disabled={!musicAvailable}
          title={
            musicAvailable
              ? musicOn
                ? "Turn music off"
                : "Turn music on"
              : "No music track installed"
          }
          aria-label="Background music"
          aria-pressed={musicOn}
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control transition-colors ${
            !musicAvailable
              ? "text-charcoal-soft/30"
              : musicOn
                ? "bg-gold-soft text-ink"
                : "text-charcoal-soft hover:bg-paper-deep"
          }`}
        >
          <Icon name={musicOn ? "volume-2" : "bell-off"} size={18} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}

/** Shared level preference, so a teacher sets Easy or Proper once. */
export function useLevel() {
  const [level, setLevel] = useState("easy");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LEVEL_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "easy" || saved === "proper") setLevel(saved);
    } catch {
      // private mode — the default stands
    }
  }, []);

  const change = useCallback((next) => {
    setLevel(next);
    try {
      localStorage.setItem(LEVEL_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  return [level, change];
}

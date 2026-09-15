"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Icon from "@/components/Icon";
import {
  SAY_RATES,
  getSayRate,
  getVoicePref,
  hasMusic,
  setMascot,
  setSayRate,
  setVoicePref,
  startMusic,
  stopMusic,
  unlockAudio,
  voiceSurvey,
} from "@/lib/games/audio";
import { MASCOT_VOICE } from "@/lib/games/voices";

/**
 * The frame every game runs inside: kiosk cover, hold-to-exit, level switch,
 * voice speed, music toggle.
 *
 * The speed control lives here rather than in any one game so that all five
 * share it and a teacher sets it once. It drives lib/games/audio.js directly,
 * which is what every game speaks through.
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

/* What each voice is called in this school. The menu says male and female
   alongside, because the control is about the voice and not about the person. */
const VOICE_LABEL = { male: "Ustaz", female: "Ustazah" };

export default function GameShell({
  title,
  subtitle,
  level,
  onLevelChange,
  mascot = "ustaz",
  children,
}) {
  const router = useRouter();
  const [holding, setHolding] = useState(0);
  const [rate, setRate] = useState(SAY_RATES[2]);
  const [rateOpen, setRateOpen] = useState(false);
  const [voice, setVoice] = useState("auto");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voices, setVoices] = useState({ genders: [], arabic: 0, loaded: false });
  const [musicAvailable, setMusicAvailable] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const holdFrom = useRef(null);
  const raf = useRef(null);

  /* Tell the audio layer which mascot is on screen, so that the default
     "auto" voice follows it: the ustaz games speak male, the ustazah games
     speak female, with nobody touching a setting. */
  useEffect(() => {
    setMascot(mascot);
  }, [mascot]);

  /* The gender being spoken, derived from props and state rather than read
     back from the audio module. The module's copy is mutated by the effect
     above, which does not re-render, so rendering from it would leave an
     ustazah game's chip permanently reading "Ustaz". */
  const shownGender = voice === "auto" ? (MASCOT_VOICE[mascot] ?? "male") : voice;

  /* What this device can actually manage. Usually fewer than two genders —
     iOS has historically shipped one Arabic voice and Chrome exposes one
     network voice — and the control disables itself in that case rather than
     offering a switch that changes nothing. The voice list arrives
     asynchronously and Chrome rebuilds it after load, hence the event. */
  useEffect(() => {
    const read = () => setVoices(voiceSurvey());
    read();
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    synth?.addEventListener?.("voiceschanged", read);
    return () => synth?.removeEventListener?.("voiceschanged", read);
  }, []);

  /* WHAT THE CHIP SAYS MUST BE WHAT THE CHILD HEARS.

     The requested gender and the spoken one are not always the same: ask for
     the ustazah on a tablet that only has Maged and Maged speaks anyway,
     because a wrong-gendered letter beats silence. The chip showed the
     REQUEST, so Harakah Lab read "Ustazah" while a male voice said the
     letter — the one thing this control must never do. It now names the voice
     that will actually be used, and says nothing about gender when no
     installed Arabic voice is recognisable. */
  const canChooseVoice = voices.genders.length >= 2;
  const spokenGender =
    !voices.loaded || voices.genders.includes(shownGender)
      ? shownGender
      : voices.genders.length === 1
        ? voices.genders[0]
        : null;

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

  /* The stored speed is read after mount, not during render: localStorage does
     not exist on the server, and a mismatch there is a hydration error. */
  useEffect(() => {
    const saved = getSayRate();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved !== rate) setRate(saved);
    // Once only — afterwards this component owns the value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A menu rather than a tap-cycle. With six speeds, cycling means up to five
     taps to reach the one you want and no way to go back — fine for two or
     three values, not for six. */
  const chooseRate = useCallback((next) => {
    unlockAudio();
    setRate(setSayRate(next));
    setRateOpen(false);
  }, []);

  /* The stored voice choice, read after mount for the same reason as the
     rate: localStorage does not exist on the server. */
  useEffect(() => {
    const saved = getVoicePref();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved !== "auto") setVoice(saved);
  }, []);

  const chooseVoice = useCallback((next) => {
    unlockAudio();
    setVoice(setVoicePref(next));
    setVoiceOpen(false);
  }, []);

  useEffect(() => {
    if (!voiceOpen) return undefined;
    const close = (e) => {
      if (e.key === undefined || e.key === "Escape") setVoiceOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [voiceOpen]);

  useEffect(() => {
    if (!rateOpen) return undefined;
    const close = (e) => {
      if (e.key === undefined || e.key === "Escape") setRateOpen(false);
    };
    // Any touch outside, or Escape, puts it away.
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [rateOpen]);

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
          {/* truncate, not wrap. With five controls beside it there is not much
              room left on a phone, and a wrapping title turns the header into
              three lines and steals the height the letter needs. */}
          <h1 className="truncate font-heading text-[17px] font-bold leading-tight text-charcoal">
            {title}
          </h1>
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

        {/* Which voice speaks. Defaults to matching the mascot on the page, so
            this chip is usually just telling a teacher what she is hearing;
            it opens a menu only when she wants to override it.

            Disabled when the device cannot offer both, which is the common
            case: the Web Speech API has no gender field, so this works by
            recognising voice NAMES, and most tablets ship a single Arabic
            voice anyway. The title says what is actually installed rather
            than leaving a dead button unexplained. */}
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setVoiceOpen((o) => !o)}
            disabled={!canChooseVoice}
            title={
              canChooseVoice
                ? voice === "auto"
                  ? `Voice follows the mascot — ${VOICE_LABEL[MASCOT_VOICE[mascot]] ?? "Ustaz"}`
                  : `Voice — ${VOICE_LABEL[voice]}`
                : voices.arabic === 0
                  ? "This device has no Arabic voice installed"
                  : voices.genders.length === 1
                    ? `This device has only a ${voices.genders[0]} Arabic voice installed`
                    : "This device has one Arabic voice, of no stated gender"
            }
            aria-label="Reciting voice"
            aria-expanded={voiceOpen}
            className={`flex h-10 items-center justify-center gap-1 rounded-control px-2 font-heading text-[12px] font-bold transition-colors ${
              !canChooseVoice
                ? "text-charcoal-soft/30"
                : voice === "auto"
                  ? "text-charcoal-soft hover:bg-paper-deep"
                  : "bg-sand text-ink"
            }`}
          >
            <Icon name="mic" size={14} />
            {/* The name drops away on a phone and the mic icon carries it
                alone: the class tablet is the primary device and has room,
                whereas on a 400px screen this label costs the game title its
                last 50px. The accessible name and the menu still say which
                voice is active. */}
            <span className="hidden sm:inline">{VOICE_LABEL[spokenGender] ?? "Voice"}</span>
          </button>

          {voiceOpen && (
            <div
              role="group"
              aria-label="Reciting voice"
              onPointerDown={(e) => e.stopPropagation()}
              className="lqk-pop-in absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-control border border-line bg-white shadow-[0_8px_24px_rgba(59,55,43,0.16)]"
            >
              {[
                ["auto", `Match the mascot (${VOICE_LABEL[MASCOT_VOICE[mascot]] ?? "Ustaz"})`],
                ["male", "Ustaz — male"],
                ["female", "Ustazah — female"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseVoice(id)}
                  aria-pressed={id === voice}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-heading text-[12px] font-bold transition-colors ${
                    id === voice ? "bg-gold-soft text-ink" : "text-charcoal hover:bg-paper-deep"
                  }`}
                >
                  <span className="min-w-0 truncate">{label}</span>
                  {id === voice && <Icon name="check" size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Voice speed: a chip showing the current one, opening a short list.
            Compact enough for a phone header that already holds three other
            controls, and two taps to any speed instead of up to five. */}
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setRateOpen((o) => !o)}
            title={`Voice speed — ${rate}x`}
            aria-label={`Voice speed ${rate} times. Tap to change.`}
            aria-expanded={rateOpen}
            className={`flex h-10 items-center justify-center rounded-control px-2 font-heading text-[13px] font-bold tabular-nums transition-colors ${
              rate === 1 ? "text-charcoal-soft hover:bg-paper-deep" : "bg-sand text-ink"
            }`}
          >
            {rate}&times;
          </button>

          {rateOpen && (
            <div
              role="group"
              aria-label="Voice speed"
              onPointerDown={(e) => e.stopPropagation()}
              className="lqk-pop-in absolute right-0 top-full z-10 mt-1 w-24 overflow-hidden rounded-control border border-line bg-white shadow-[0_8px_24px_rgba(59,55,43,0.16)]"
            >
              {SAY_RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => chooseRate(r)}
                  aria-pressed={r === rate}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left font-heading text-[13px] font-bold tabular-nums transition-colors ${
                    r === rate ? "bg-gold-soft text-ink" : "text-charcoal hover:bg-paper-deep"
                  }`}
                >
                  <span>{r}&times;</span>
                  {r === rate && <Icon name="check" size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>

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

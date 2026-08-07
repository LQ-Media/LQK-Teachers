"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Icon from "@/components/Icon";
import { PRAYER_KEYS, PRAYER_LABELS, soundSrc } from "@/lib/azan/catalog";
import { loadTimings, savedChoice } from "@/lib/azan/solat-client";

// Global in-app azan engine, mounted once in the portal layout. While the
// portal is open (tab or installed PWA), it watches the clock and plays the
// user's chosen azan when an enabled prayer's time arrives. When the app is
// closed, the server-side push scheduler takes over (notification only —
// browsers don't allow audio from a closed page).

const LAST_PLAYED_KEY = "lqk_azan_last_played";
const CHECK_MS = 15_000;
const GRACE_MINUTES = 5; // still play if we wake up a few minutes late

// A settings snapshot other components can refresh via this window event.
export const AZAN_SETTINGS_EVENT = "lqk-azan-settings-changed";

export default function AzanPlayer() {
  const [config, setConfig] = useState(null); // { settings, customSounds }
  const [nowPlaying, setNowPlaying] = useState(null); // { prayer, time }
  const audioRef = useRef(null);
  const configRef = useRef(null);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Load settings once; refresh whenever the settings page saves.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/azan/settings")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && data) setConfig(data);
        })
        .catch(() => {});
    load();
    const onChange = (e) => {
      if (e.detail?.settings) {
        setConfig((c) => ({ ...(c || {}), settings: e.detail.settings }));
      } else {
        load();
      }
    };
    window.addEventListener(AZAN_SETTINGS_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(AZAN_SETTINGS_EVENT, onChange);
    };
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setNowPlaying(null);
  }, []);

  useEffect(() => {
    let disposed = false;

    async function check() {
      const settings = configRef.current?.settings;
      if (disposed || !settings || settings.muted) return;
      if (audioRef.current) return; // already playing

      const enabled = PRAYER_KEYS.filter((k) => settings.prayers?.[k]?.enabled);
      if (enabled.length === 0) return;

      let data;
      try {
        data = await loadTimings(savedChoice());
      } catch {
        return; // offline — try again next tick
      }
      if (disposed || !data?.timings) return;

      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const today = now.toDateString();

      for (const prayer of enabled) {
        const t = String(data.timings[prayer] || "").slice(0, 5);
        const [h, m] = t.split(":").map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) continue;
        const prayerMin = h * 60 + m;
        const late = nowMin - prayerMin;
        if (late < 0 || late > GRACE_MINUTES) continue;

        const playedKey = `${today}|${prayer}`;
        try {
          if (localStorage.getItem(LAST_PLAYED_KEY) === playedKey) continue;
          localStorage.setItem(LAST_PLAYED_KEY, playedKey); // set first — never loop
        } catch {
          continue;
        }

        const audio = new Audio(soundSrc(settings.prayers[prayer].sound));
        audio.addEventListener("ended", () => {
          audioRef.current = null;
          setNowPlaying(null);
        });
        try {
          await audio.play();
          audioRef.current = audio;
          setNowPlaying({ prayer, time: t });
        } catch {
          // Autoplay blocked (no interaction yet) — fall back to a local
          // notification so the moment isn't missed entirely.
          try {
            if (Notification.permission === "granted") {
              const reg = await navigator.serviceWorker?.ready;
              reg?.showNotification(`🕌 Azan ${PRAYER_LABELS[prayer]} — ${t}`, {
                body: "Tap to open the portal and hear the azan.",
                icon: "/icon-192.png",
                tag: `azan-${prayer}`,
                data: { url: "/solat", prayer },
              });
            }
          } catch {
            // notifications unavailable — nothing more we can do
          }
        }
        break; // at most one azan at a time
      }
    }

    const interval = setInterval(check, CHECK_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Unmount safety: never leave audio playing after navigation re-mounts.
  useEffect(() => () => stop(), [stop]);

  if (!nowPlaying) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h,0px)+12px)] z-50 flex justify-center px-4 lg:bottom-6">
      <div className="flex items-center gap-3 rounded-pill border-[0.5px] border-line bg-white/95 py-2 pl-4 pr-2 shadow-[0_8px_30px_rgba(64,53,72,0.18)] backdrop-blur-md">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold text-white">
          <Icon name="volume-2" size={16} />
        </span>
        <div className="text-[13px] font-semibold text-charcoal">
          Azan {PRAYER_LABELS[nowPlaying.prayer]}
          <span className="ml-1.5 text-charcoal-soft">· {nowPlaying.time}</span>
        </div>
        <button
          type="button"
          onClick={stop}
          aria-label="Stop azan"
          className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal-soft transition-colors hover:bg-paper-deep hover:text-charcoal"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}

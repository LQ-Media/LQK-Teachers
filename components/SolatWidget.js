"use client";

import { useEffect, useState } from "react";

const PRAYERS = [
  { key: "Fajr", label: "Subuh", icon: "🌙" },
  { key: "Dhuhr", label: "Zohor", icon: "☀️" },
  { key: "Asr", label: "Asar", icon: "🌤" },
  { key: "Maghrib", label: "Maghrib", icon: "🌇" },
  { key: "Isha", label: "Isyak", icon: "✨" },
];

const CACHE_KEY = "lqk_solat_cache";

export default function SolatWidget() {
  const [timings, setTimings] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const today = new Date().toDateString();
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached?.date === today) {
        setTimings(cached.timings);
        return;
      }
    } catch {
      // ignore malformed cache
    }

    fetch("https://api.aladhan.com/v1/timingsByCity?city=Singapore&country=Singapore&method=11")
      .then((res) => {
        if (!res.ok) throw new Error("Request failed");
        return res.json();
      })
      .then((data) => {
        const timings = data?.data?.timings;
        if (!timings) throw new Error("Malformed response");
        setTimings(timings);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, timings }));
      })
      .catch(() => setError("Prayer times unavailable — check your connection"));
  }, []);

  if (error) {
    return (
      <div className="bg-white border-[0.5px] border-line rounded-card p-4 text-[12px] text-rust">
        {error}
      </div>
    );
  }

  if (!timings) {
    return (
      <div className="bg-white border-[0.5px] border-line rounded-card p-4 flex gap-3">
        {PRAYERS.map((p) => (
          <div key={p.key} className="flex-1 h-14 rounded-control bg-paper-deep animate-pulse" />
        ))}
      </div>
    );
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const parsed = PRAYERS.map((p) => {
    const [h, m] = (timings[p.key] || "00:00").split(":").map(Number);
    return { ...p, minutes: h * 60 + m, time: timings[p.key] };
  });
  const nextIndex = parsed.findIndex((p) => p.minutes > nowMinutes);

  return (
    <div className="bg-white border-[0.5px] border-line rounded-card p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-charcoal-soft mb-3">
        Solat times · Singapore (MUIS)
      </div>
      <div className="flex gap-2">
        {parsed.map((p, i) => {
          const isCurrentOrNext = i === (nextIndex === -1 ? parsed.length - 1 : nextIndex);
          const isPast = nextIndex !== -1 && i < nextIndex;
          return (
            <div
              key={p.key}
              className={`flex-1 rounded-control px-2 py-2.5 text-center ${
                isCurrentOrNext ? "bg-sage-soft" : ""
              } ${isPast ? "opacity-50" : ""}`}
            >
              <div className="text-[15px] mb-1">{p.icon}</div>
              <div className="text-[11px] font-semibold text-charcoal">{p.label}</div>
              <div className="text-[11px] text-charcoal-soft">{p.time}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

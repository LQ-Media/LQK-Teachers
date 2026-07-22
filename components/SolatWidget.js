"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

const PRAYERS = [
  { key: "Fajr", label: "Subuh", icon: "sunrise" },
  { key: "Dhuhr", label: "Zohor", icon: "sun" },
  { key: "Asr", label: "Asar", icon: "cloud-sun" },
  { key: "Maghrib", label: "Maghrib", icon: "sunset" },
  { key: "Isha", label: "Isyak", icon: "moon-star" },
];

const CACHE_KEY = "lqk_solat_cache_v2";

// Pick the local prayer-time authority (Aladhan calculation method) from the
// device timezone, so timings match local convention. Coordinates still drive
// the precise times; the method only tunes the calculation.
function localeForTimezone(tz) {
  switch (tz) {
    case "Asia/Singapore":
      return { method: 11, authority: "MUIS", city: "Singapore", country: "Singapore" };
    case "Asia/Kuala_Lumpur":
      return { method: 17, authority: "JAKIM", city: "Kuala Lumpur", country: "Malaysia" };
    case "Asia/Kuching":
      return { method: 17, authority: "JAKIM", city: "Kuching", country: "Malaysia" };
    case "Asia/Jakarta":
      return { method: 20, authority: "KEMENAG", city: "Jakarta", country: "Indonesia" };
    case "Asia/Pontianak":
      return { method: 20, authority: "KEMENAG", city: "Pontianak", country: "Indonesia" };
    case "Asia/Makassar":
      return { method: 20, authority: "KEMENAG", city: "Makassar", country: "Indonesia" };
    case "Asia/Jayapura":
      return { method: 20, authority: "KEMENAG", city: "Jayapura", country: "Indonesia" };
    default:
      // Unknown region — fall back to the org's home authority.
      return { method: 11, authority: "MUIS", city: "Singapore", country: "Singapore" };
  }
}

function cityFromTz(tz) {
  if (!tz) return "Your location";
  return tz.split("/").pop().replace(/_/g, " ");
}

function ddmmyyyy(d) {
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export default function SolatWidget() {
  const [timings, setTimings] = useState(null);
  const [placeLabel, setPlaceLabel] = useState("");
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
      if (cached?.date === today && cached.timings) {
        // Seeded after mount on purpose: localStorage is unavailable during SSR,
        // so a lazy initializer would cause a hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTimings(cached.timings);
        setPlaceLabel(cached.label || "");
        return; // already have today's times — don't re-prompt for location
      }
    } catch {
      // ignore malformed cache
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = localeForTimezone(tz);
    const dateStr = ddmmyyyy(new Date());

    function store(t, label) {
      setTimings(t);
      setPlaceLabel(label);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, timings: t, label }));
      } catch {
        // ignore quota/availability errors
      }
    }

    function loadByCity() {
      fetch(
        `https://api.aladhan.com/v1/timingsByCity/${dateStr}?city=${encodeURIComponent(locale.city)}&country=${encodeURIComponent(locale.country)}&method=${locale.method}`
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("request failed"))))
        .then((j) => {
          const t = j?.data?.timings;
          if (!t) throw new Error("malformed");
          store(t, `${locale.city} (${locale.authority})`);
        })
        .catch(() => setError("Prayer times unavailable — check your connection"));
    }

    function loadByCoords(lat, lng) {
      fetch(`https://api.aladhan.com/v1/timings/${dateStr}?latitude=${lat}&longitude=${lng}&method=${locale.method}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("request failed"))))
        .then((j) => {
          const t = j?.data?.timings;
          if (!t) throw new Error("malformed");
          const city = cityFromTz(j?.data?.meta?.timezone || tz);
          store(t, `${city} (${locale.authority})`);
        })
        .catch(loadByCity);
    }

    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => loadByCoords(pos.coords.latitude.toFixed(4), pos.coords.longitude.toFixed(4)),
        () => loadByCity(), // permission denied / unavailable → timezone-based city
        { timeout: 8000, maximumAge: 3_600_000 }
      );
    } else {
      loadByCity();
    }
  }, []);

  if (error) {
    return (
      <div className="bg-white border-[0.5px] border-line rounded-card p-4 text-[12px] text-rust">{error}</div>
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
        Solat times · {placeLabel || "Singapore (MUIS)"}
      </div>
      <div className="flex gap-2">
        {parsed.map((p, i) => {
          const isCurrentOrNext = i === (nextIndex === -1 ? parsed.length - 1 : nextIndex);
          const isPast = nextIndex !== -1 && i < nextIndex;
          return (
            <div
              key={p.key}
              className={`flex-1 rounded-control px-2 py-2.5 text-center ${isCurrentOrNext ? "bg-sage-soft" : ""} ${isPast ? "opacity-50" : ""}`}
            >
              <div className="mb-1 flex justify-center text-ink">
                <Icon name={p.icon} size={18} />
              </div>
              <div className="text-[11px] font-semibold text-charcoal">{p.label}</div>
              <div className="text-[11px] text-charcoal-soft">{p.time}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

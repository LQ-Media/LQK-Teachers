"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { COUNTRIES, BY_CODE, countryForTimezone } from "@/lib/countries";

const PRAYERS = [
  { key: "Fajr", label: "Subuh", icon: "sunrise" },
  { key: "Dhuhr", label: "Zohor", icon: "sun" },
  { key: "Asr", label: "Asar", icon: "cloud-sun" },
  { key: "Maghrib", label: "Maghrib", icon: "sunset" },
  { key: "Isha", label: "Isyak", icon: "moon-star" },
];

// ---- Source ------------------------------------------------------------
// Prayer times are fetched from the Aladhan API (api.aladhan.com). Each
// country below carries the `method` id of its OFFICIAL prayer-time authority
// as published by that API (verified against api.aladhan.com/v1/methods), so
// timings match local convention rather than a generic calculation.
const API_NAME = "Aladhan API";
const API_HREF = "https://aladhan.com/prayer-times-api";

const AUTO = "auto";

const CHOICE_KEY = "lqk_solat_country";
const CACHE_KEY = "lqk_solat_cache_v3";

function cityFromTz(tz) {
  if (!tz) return "Your location";
  return tz.split("/").pop().replace(/_/g, " ");
}

function ddmmyyyy(d) {
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export default function SolatWidget() {
  const [choice, setChoice] = useState(AUTO);
  const [ready, setReady] = useState(false);
  const [timings, setTimings] = useState(null);
  const [placeLabel, setPlaceLabel] = useState("");
  const [authority, setAuthority] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Restore the saved country after mount (localStorage is unavailable during
  // SSR, so reading it in a lazy initializer would cause a hydration mismatch).
  useEffect(() => {
    let saved = null;
    try {
      saved = localStorage.getItem(CHOICE_KEY);
    } catch {
      // ignore availability errors
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved && (saved === AUTO || BY_CODE[saved])) setChoice(saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const today = new Date().toDateString();
    const dateStr = ddmmyyyy(new Date());

    // Same country + same day → reuse the cached timings, no refetch.
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached?.date === today && cached.choice === choice && cached.timings) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setTimings(cached.timings);
        setPlaceLabel(cached.label || "");
        setAuthority(cached.authority || "");
        setError(null);
        return;
      }
    } catch {
      // ignore malformed cache
    }

    setLoading(true);
    setError(null);

    function store(t, label, auth) {
      if (cancelled) return;
      setTimings(t);
      setPlaceLabel(label);
      setAuthority(auth);
      setLoading(false);
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ date: today, choice, timings: t, label, authority: auth })
        );
      } catch {
        // ignore quota/availability errors
      }
    }

    function fail() {
      if (cancelled) return;
      setLoading(false);
      setError("Prayer times unavailable — check your connection");
    }

    async function fetchTimings(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("request failed");
      const json = await res.json();
      const t = json?.data?.timings;
      if (!t) throw new Error("malformed");
      return { timings: t, meta: json?.data?.meta };
    }

    async function loadByCity(spec) {
      const { timings: t } = await fetchTimings(
        `https://api.aladhan.com/v1/timingsByCity/${dateStr}?city=${encodeURIComponent(spec.city)}&country=${encodeURIComponent(spec.name)}&method=${spec.method}`
      );
      store(t, spec.city, spec.authority);
    }

    async function loadByCoords(lat, lng, spec, tz) {
      const { timings: t, meta } = await fetchTimings(
        `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${lat}&longitude=${lng}&method=${spec.method}`
      );
      store(t, cityFromTz(meta?.timezone || tz), spec.authority);
    }

    if (choice === AUTO) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const spec = countryForTimezone(tz);
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            loadByCoords(pos.coords.latitude.toFixed(4), pos.coords.longitude.toFixed(4), spec, tz).catch(() =>
              loadByCity(spec).catch(fail)
            ),
          () => loadByCity(spec).catch(fail), // permission denied → timezone-based city
          { timeout: 8000, maximumAge: 3_600_000 }
        );
      } else {
        loadByCity(spec).catch(fail);
      }
    } else {
      // Explicit country: use its reference city so the result is predictable
      // (no location permission needed).
      loadByCity(BY_CODE[choice] || BY_CODE.SG).catch(fail);
    }

    return () => {
      cancelled = true;
    };
  }, [choice, ready]);

  function pick(value) {
    setChoice(value);
    try {
      localStorage.setItem(CHOICE_KEY, value);
    } catch {
      // ignore availability errors
    }
  }

  const picker = (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">Country for prayer times</span>
      <span className="text-charcoal-soft">
        <Icon name="globe" size={14} />
      </span>
      <select
        value={choice}
        onChange={(e) => pick(e.target.value)}
        className="max-w-[190px] cursor-pointer rounded-control border-[0.5px] border-line bg-white px-2 py-1 text-[12px] font-semibold text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
      >
        <option value={AUTO}>Auto-detect my location</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );

  const source = (
    <div className="mt-2.5 text-center text-[11px] text-charcoal-soft">
      Source:{" "}
      <a
        href={API_HREF}
        target="_blank"
        rel="noreferrer noopener"
        className="font-semibold text-charcoal underline decoration-line hover:text-ink"
      >
        {API_NAME}
      </a>
      {authority ? ` · ${authority} calculation` : ""}
    </div>
  );

  if (error) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-bold uppercase tracking-wider text-charcoal-soft">Prayer times</span>
          {picker}
        </div>
        <p className="text-[12px] text-rust">{error}</p>
        {source}
      </div>
    );
  }

  if (!timings || loading) {
    return (
      <div className="rounded-card border-[0.5px] border-line bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] font-bold uppercase tracking-wider text-charcoal-soft">Prayer times</span>
          {picker}
        </div>
        <div className="flex gap-3">
          {PRAYERS.map((p) => (
            <div key={p.key} className="h-14 flex-1 animate-pulse rounded-control bg-paper-deep" />
          ))}
        </div>
      </div>
    );
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const parsed = PRAYERS.map((p) => {
    const [h, m] = (timings[p.key] || "00:00").split(":").map(Number);
    return { ...p, minutes: h * 60 + m, time: timings[p.key] };
  });
  const nextIndex = parsed.findIndex((p) => p.minutes > nowMinutes);
  const next = nextIndex === -1 ? parsed[0] : parsed[nextIndex]; // wraps to tomorrow's Subuh
  const diff = (((next.minutes - nowMinutes) % 1440) + 1440) % 1440;
  const countdown = diff >= 60 ? `${Math.floor(diff / 60)}h ${diff % 60}m` : `${diff}m`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-bold uppercase tracking-wider text-charcoal-soft">
          Prayer times · {placeLabel || "Singapore"}
        </span>
        {picker}
      </div>
      <div className="mb-4 grid grid-cols-5 justify-items-center gap-2">
        {parsed.map((p, i) => {
          const isNext = i === (nextIndex === -1 ? 0 : nextIndex);
          const isPast = nextIndex !== -1 && i < nextIndex;
          return (
            <div key={p.key} className={`text-center ${isPast ? "opacity-45" : ""}`}>
              <div
                className={`mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                  isNext ? "bg-gold text-white shadow-[0_4px_12px_rgba(242,169,192,0.35)]" : "bg-gold-soft text-ink"
                }`}
              >
                <Icon name={p.icon} size={22} />
              </div>
              <div className="text-[13px] font-semibold text-charcoal">{p.label}</div>
              <div className="text-[12px] text-charcoal-soft">{p.time}</div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-2 rounded-control bg-gold px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(242,169,192,0.3)]">
        <span>Next prayer:</span>
        <span className="text-[15px] font-bold">{next.label}</span>
        <span>in {countdown}</span>
      </div>
      {source}
    </div>
  );
}

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

// ---- Source ------------------------------------------------------------
// Prayer times are fetched from the Aladhan API (api.aladhan.com). Each
// country below carries the `method` id of its OFFICIAL prayer-time authority
// as published by that API (verified against api.aladhan.com/v1/methods), so
// timings match local convention rather than a generic calculation.
const API_NAME = "Aladhan API";
const API_HREF = "https://aladhan.com/prayer-times-api";

const AUTO = "auto";

// Reference city per country — the times shown are for this city, which is
// surfaced in the label so it's never ambiguous in large countries.
const COUNTRIES = [
  { code: "SG", name: "Singapore", city: "Singapore", method: 11, authority: "MUIS" },
  { code: "MY", name: "Malaysia", city: "Kuala Lumpur", method: 17, authority: "JAKIM" },
  { code: "ID", name: "Indonesia", city: "Jakarta", method: 20, authority: "Kemenag" },
  { code: "BN", name: "Brunei", city: "Bandar Seri Begawan", method: 17, authority: "JAKIM (regional)" },
  { code: "AU", name: "Australia", city: "Sydney", method: 3, authority: "Muslim World League" },
  { code: "BH", name: "Bahrain", city: "Manama", method: 8, authority: "Gulf Region" },
  { code: "BD", name: "Bangladesh", city: "Dhaka", method: 1, authority: "Karachi" },
  { code: "CA", name: "Canada", city: "Toronto", method: 2, authority: "ISNA" },
  { code: "EG", name: "Egypt", city: "Cairo", method: 5, authority: "Egyptian General Authority" },
  { code: "FR", name: "France", city: "Paris", method: 12, authority: "UOIF" },
  { code: "IN", name: "India", city: "New Delhi", method: 1, authority: "Karachi" },
  { code: "IR", name: "Iran", city: "Tehran", method: 7, authority: "Univ. of Tehran" },
  { code: "JO", name: "Jordan", city: "Amman", method: 23, authority: "Ministry of Awqaf" },
  { code: "KW", name: "Kuwait", city: "Kuwait City", method: 9, authority: "Kuwait" },
  { code: "MA", name: "Morocco", city: "Casablanca", method: 21, authority: "Morocco" },
  { code: "OM", name: "Oman", city: "Muscat", method: 8, authority: "Gulf Region" },
  { code: "PK", name: "Pakistan", city: "Karachi", method: 1, authority: "Karachi" },
  { code: "PH", name: "Philippines", city: "Manila", method: 3, authority: "Muslim World League" },
  { code: "QA", name: "Qatar", city: "Doha", method: 10, authority: "Qatar" },
  { code: "SA", name: "Saudi Arabia", city: "Makkah", method: 4, authority: "Umm Al-Qura" },
  { code: "TH", name: "Thailand", city: "Bangkok", method: 3, authority: "Muslim World League" },
  { code: "TN", name: "Tunisia", city: "Tunis", method: 18, authority: "Tunisia" },
  { code: "TR", name: "Türkiye", city: "Istanbul", method: 13, authority: "Diyanet" },
  { code: "AE", name: "United Arab Emirates", city: "Dubai", method: 16, authority: "Dubai" },
  { code: "GB", name: "United Kingdom", city: "London", method: 3, authority: "Muslim World League" },
  { code: "US", name: "United States", city: "New York", method: 2, authority: "ISNA" },
];

const BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

const CHOICE_KEY = "lqk_solat_country";
const CACHE_KEY = "lqk_solat_cache_v3";

// Auto mode: infer the country (and therefore its authority) from the device
// timezone. Coordinates still drive the precise times; the method only tunes
// the calculation.
function autoSpecForTimezone(tz) {
  const region = String(tz || "");
  if (region === "Asia/Singapore") return BY_CODE.SG;
  if (region === "Asia/Kuala_Lumpur" || region === "Asia/Kuching") return BY_CODE.MY;
  if (/^Asia\/(Jakarta|Pontianak|Makassar|Jayapura)$/.test(region)) return BY_CODE.ID;
  if (region === "Asia/Brunei") return BY_CODE.BN;
  if (region === "Asia/Bangkok") return BY_CODE.TH;
  if (region === "Asia/Manila") return BY_CODE.PH;
  if (region === "Asia/Riyadh") return BY_CODE.SA;
  if (region === "Asia/Dubai") return BY_CODE.AE;
  if (region === "Asia/Qatar") return BY_CODE.QA;
  if (region === "Asia/Kuwait") return BY_CODE.KW;
  if (region === "Asia/Karachi") return BY_CODE.PK;
  if (region === "Asia/Kolkata" || region === "Asia/Calcutta") return BY_CODE.IN;
  if (region === "Asia/Dhaka") return BY_CODE.BD;
  if (region === "Asia/Tehran") return BY_CODE.IR;
  if (region === "Europe/Istanbul") return BY_CODE.TR;
  if (region === "Europe/London") return BY_CODE.GB;
  if (region === "Europe/Paris") return BY_CODE.FR;
  if (region === "Africa/Cairo") return BY_CODE.EG;
  if (region.startsWith("America/")) return BY_CODE.US;
  if (region.startsWith("Australia/")) return BY_CODE.AU;
  // Unknown region — fall back to the org's home authority.
  return BY_CODE.SG;
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
      const spec = autoSpecForTimezone(tz);
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
                  isNext ? "bg-gold text-white shadow-[0_4px_12px_rgba(224,169,59,0.35)]" : "bg-gold-soft text-ink"
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
      <div className="flex items-center justify-center gap-2 rounded-control bg-gold px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(224,169,59,0.3)]">
        <span>Next prayer:</span>
        <span className="text-[15px] font-bold">{next.label}</span>
        <span>in {countdown}</span>
      </div>
      {source}
    </div>
  );
}

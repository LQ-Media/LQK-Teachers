"use client";

// Client-side prayer-times loader shared by the Solat & Azan page and the
// global AzanPlayer. Uses the SAME localStorage keys as the dashboard's
// SolatWidget, so all three always agree on the chosen country and today's
// cached timings, and the Aladhan API is hit at most once per day per device.

import { BY_CODE, countryForTimezone } from "@/lib/countries";

export const CHOICE_KEY = "lqk_solat_country";
export const CACHE_KEY = "lqk_solat_cache_v3";
export const AUTO = "auto";

export function ddmmyyyy(d) {
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function savedChoice() {
  try {
    const saved = localStorage.getItem(CHOICE_KEY);
    if (saved && (saved === AUTO || BY_CODE[saved])) return saved;
  } catch {
    // localStorage unavailable
  }
  return AUTO;
}

export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Singapore";
  } catch {
    return "Asia/Singapore";
  }
}

function cityFromTz(tz) {
  if (!tz) return "Your location";
  return tz.split("/").pop().replace(/_/g, " ");
}

async function fetchTimings(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("request failed");
  const json = await res.json();
  const t = json?.data?.timings;
  if (!t) throw new Error("malformed");
  return { timings: t, meta: json?.data?.meta };
}

/**
 * Resolve today's timings for a country choice ('auto' or a COUNTRIES code),
 * reusing the widget's daily cache. Returns { timings, label, authority }.
 * `useGeo` opts into a device-GPS refinement for 'auto' (the widget's
 * behaviour); the background player skips it to avoid permission prompts.
 */
export async function loadTimings(choice, { useGeo = false } = {}) {
  const today = new Date().toDateString();
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (cached?.date === today && cached.choice === choice && cached.timings) {
      return { timings: cached.timings, label: cached.label || "", authority: cached.authority || "" };
    }
  } catch {
    // malformed cache — refetch
  }

  const dateStr = ddmmyyyy(new Date());
  const store = (timings, label, authority) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, choice, timings, label, authority }));
    } catch {
      // quota — non-fatal
    }
    return { timings, label, authority };
  };

  const byCity = async (spec) => {
    const { timings } = await fetchTimings(
      `https://api.aladhan.com/v1/timingsByCity/${dateStr}?city=${encodeURIComponent(spec.city)}&country=${encodeURIComponent(spec.name)}&method=${spec.method}`
    );
    return store(timings, spec.city, spec.authority);
  };

  if (choice !== AUTO) return byCity(BY_CODE[choice] || BY_CODE.SG);

  const tz = deviceTimezone();
  const spec = countryForTimezone(tz) || BY_CODE.SG;

  if (useGeo && typeof navigator !== "undefined" && navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 3_600_000 })
      );
      const { timings, meta } = await fetchTimings(
        `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${pos.coords.latitude.toFixed(4)}&longitude=${pos.coords.longitude.toFixed(4)}&method=${spec.method}`
      );
      return store(timings, cityFromTz(meta?.timezone || tz), spec.authority);
    } catch {
      // permission denied / geo failure → timezone city
    }
  }
  return byCity(spec);
}

/** Country code the server should schedule with (resolves 'auto' via tz). */
export function scheduleCountry(choice) {
  if (choice !== AUTO) return choice;
  return (countryForTimezone(deviceTimezone()) || BY_CODE.SG).code;
}

import "server-only";
import { BY_CODE, countryForTimezone } from "@/lib/countries";
import { PRAYER_KEYS, PRAYER_LABELS } from "./catalog";
import { usersWithSubscriptions, subscriptionsFor } from "./store";
import { sendPush } from "./push";

// Server-side azan push scheduler, started once per server from
// instrumentation.js. Every tick it checks, for each user with at least one
// push subscription, whether one of their enabled prayers begins at the
// current minute IN THEIR TIMEZONE, and fires a web-push notification if so.
//
// Prayer timings come from the same Aladhan reference-city endpoint the
// dashboard widget uses, so the notification matches what the user sees.

const TICK_MS = 20_000;
const DEFAULT_TZ = "Asia/Singapore";

// `${code}|${dd-mm-yyyy}` → Promise<timings map>; misses are retried next tick.
const timingsCache = new Map();
// `${teacherId}|${prayer}|${localDate}` → sent (kept for the current day only).
const sent = new Set();

function localParts(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const hour = get("hour") === "24" ? "00" : get("hour");
    return { date: `${get("day")}-${get("month")}-${get("year")}`, time: `${hour}:${get("minute")}` };
  } catch {
    return null;
  }
}

async function timingsForSpec(spec, dateStr) {
  const key = `${spec.code}|${dateStr}`;
  if (!timingsCache.has(key)) {
    const url =
      `https://api.aladhan.com/v1/timingsByCity/${dateStr}` +
      `?city=${encodeURIComponent(spec.city)}&country=${encodeURIComponent(spec.name)}&method=${spec.method}`;
    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`aladhan ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const t = json?.data?.timings;
        if (!t) throw new Error("aladhan: malformed response");
        return t;
      })
      .catch((err) => {
        timingsCache.delete(key); // retry on the next tick
        throw err;
      });
    timingsCache.set(key, promise);
    // Keep the cache from accumulating past days.
    if (timingsCache.size > 200) timingsCache.clear();
  }
  return timingsCache.get(key);
}

async function tick() {
  let users;
  try {
    users = usersWithSubscriptions();
  } catch (err) {
    console.error("[azan] scheduler query failed:", err?.message || err);
    return;
  }

  for (const user of users) {
    if (user.muted) continue;
    let prayers;
    try {
      prayers = JSON.parse(user.prayers);
    } catch {
      continue;
    }
    const enabled = PRAYER_KEYS.filter((k) => prayers?.[k]?.enabled);
    if (enabled.length === 0) continue;

    const tz = user.tz || DEFAULT_TZ;
    const spec = user.country === "auto" ? countryForTimezone(tz) || BY_CODE.SG : BY_CODE[user.country] || BY_CODE.SG;
    const local = localParts(tz);
    if (!local) continue;

    let timings;
    try {
      timings = await timingsForSpec(spec, local.date);
    } catch {
      continue; // network hiccup — next tick retries
    }

    for (const prayer of enabled) {
      const t = String(timings[prayer] || "").slice(0, 5);
      if (t !== local.time) continue;
      const sentKey = `${user.teacher_id}|${prayer}|${local.date}`;
      if (sent.has(sentKey)) continue;
      sent.add(sentKey);

      const label = PRAYER_LABELS[prayer] || prayer;
      const payload = {
        title: `🕌 Azan ${label} — ${t}`,
        body: `It's time for ${label} in ${spec.city}. Open the portal to hear the azan.`,
        prayer,
        time: t,
        url: "/solat",
      };
      for (const sub of subscriptionsFor(user.teacher_id)) {
        await sendPush(sub, payload);
      }
    }
  }

  // Drop yesterday's dedupe keys once the set grows past a day's worth.
  if (sent.size > 5000) sent.clear();
}

export function startAzanScheduler() {
  // Survive dev-server HMR re-imports: only ever one interval per process.
  if (globalThis.__lqkAzanScheduler) return;
  globalThis.__lqkAzanScheduler = setInterval(() => {
    tick().catch((err) => console.error("[azan] tick failed:", err?.message || err));
  }, TICK_MS);
  console.log("[azan] push scheduler started");
}

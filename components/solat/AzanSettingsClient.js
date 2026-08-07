"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Icon from "@/components/Icon";
import { COUNTRIES } from "@/lib/countries";
import {
  PRAYER_KEYS,
  PRAYER_LABELS,
  PRAYER_ICONS,
  BUNDLED_SOUNDS,
  soundSrc,
  isCustomSoundId,
} from "@/lib/azan/catalog";
import { AUTO, CHOICE_KEY, savedChoice, loadTimings, deviceTimezone } from "@/lib/azan/solat-client";
import { AZAN_SETTINGS_EVENT } from "./AzanPlayer";

// The Solat & Azan page: today's timetable with a live countdown, per-prayer
// azan toggles + sound choice, sound previews/uploads, and push notifications
// for when the app is closed.

// Same per-prayer pastel assignment as the dashboard SolatWidget — dawn/night
// lavender, the bright hours peach and rose.
const PRAYER_TONES = {
  Fajr: "bg-gold-soft text-ink",
  Dhuhr: "bg-sand text-ink",
  Asr: "bg-sage-soft text-ink",
  Maghrib: "bg-sand text-ink",
  Isha: "bg-gold-soft text-ink",
};

function broadcast(settings) {
  window.dispatchEvent(new CustomEvent(AZAN_SETTINGS_EVENT, { detail: { settings } }));
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 flex-shrink-0 rounded-pill transition-colors duration-200 ${
        checked ? "bg-gold" : "bg-paper-deep border-[0.5px] border-line"
      }`}
    >
      <span
        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(64,53,72,0.25)] transition-[left] duration-200 ${
          checked ? "left-[26px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

export default function AzanSettingsClient() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(null);
  const [customSounds, setCustomSounds] = useState([]);
  const [vapidKey, setVapidKey] = useState(null);
  const [subscriptionCount, setSubscriptionCount] = useState(0);

  const [choice, setChoice] = useState(AUTO);
  const [timings, setTimings] = useState(null);
  const [placeLabel, setPlaceLabel] = useState("");
  const [authority, setAuthority] = useState("");
  const [timesError, setTimesError] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const [previewId, setPreviewId] = useState(null);
  const [pushState, setPushState] = useState("unknown"); // unknown|unsupported|off|on|busy
  const [pushError, setPushError] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const previewRef = useRef(null);
  const fileRef = useRef(null);
  // Latest settings for callbacks, so save() can compute the optimistic next
  // state outside React's updater function.
  const settingsRef = useRef(null);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // ---- Initial load ------------------------------------------------------
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(savedChoice());
    fetch("/api/azan/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setSettings(data.settings);
        setCustomSounds(data.customSounds || []);
        setVapidKey(data.vapidPublicKey);
        setSubscriptionCount(data.subscriptionCount || 0);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // ---- Prayer times (same source + cache as the dashboard widget) --------
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimesError(null);
    loadTimings(choice, { useGeo: choice === AUTO })
      .then((data) => {
        if (cancelled) return;
        setTimings(data.timings);
        setPlaceLabel(data.label);
        setAuthority(data.authority);
      })
      .catch(() => !cancelled && setTimesError("Prayer times unavailable — check your connection"));
    return () => {
      cancelled = true;
    };
  }, [choice]);

  // ---- Push subscription state for THIS device ---------------------------
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPushState("unsupported");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushState(sub ? "on" : "off"))
      .catch(() => setPushState("off"));
  }, []);

  // ---- Persistence helpers ------------------------------------------------
  const save = useCallback((patch) => {
    const current = settingsRef.current;
    const optimistic = { ...current, ...patch, prayers: patch.prayers || current.prayers };
    setSettings(optimistic);
    broadcast(optimistic);
    fetch("/api/azan/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.settings) {
          setSettings(data.settings);
          broadcast(data.settings);
        }
      })
      .catch(() => {});
  }, []);

  function setPrayer(key, patch) {
    const prayers = { ...settings.prayers, [key]: { ...settings.prayers[key], ...patch } };
    save({ prayers });
  }

  function pickCountry(value) {
    setChoice(value);
    try {
      localStorage.setItem(CHOICE_KEY, value);
      localStorage.removeItem("lqk_solat_cache_v3");
    } catch {
      // ignore
    }
    save({ country: value, tz: deviceTimezone() });
  }

  // ---- Preview ------------------------------------------------------------
  function stopPreview() {
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current = null;
    }
    setPreviewId(null);
  }

  function togglePreview(id) {
    if (previewId === id) return stopPreview();
    stopPreview();
    const audio = new Audio(soundSrc(id));
    audio.addEventListener("ended", () => {
      previewRef.current = null;
      setPreviewId(null);
    });
    audio.play().then(
      () => {
        previewRef.current = audio;
        setPreviewId(id);
      },
      () => {}
    );
  }

  useEffect(() => () => stopPreview(), []);

  // ---- Push enable/disable -------------------------------------------------
  async function enablePush() {
    setPushError(null);
    setPushState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushError("Notifications were not allowed. Enable them for this site in your browser settings.");
        setPushState("off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const res = await fetch("/api/azan/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), tz: deviceTimezone(), country: choice }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      setPushState("on");
      setSubscriptionCount((n) => n + 1);
    } catch {
      setPushError("Could not enable notifications on this device.");
      setPushState("off");
    }
  }

  async function disablePush() {
    setPushError(null);
    setPushState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/azan/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
        setSubscriptionCount((n) => Math.max(0, n - 1));
      }
      setPushState("off");
    } catch {
      setPushError("Could not disable notifications on this device.");
      setPushState("on");
    }
  }

  // ---- Upload ---------------------------------------------------------------
  async function onUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    setUploadBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("label", file.name.replace(/\.[a-z0-9]+$/i, ""));
      const res = await fetch("/api/azan/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setCustomSounds((s) => [...s, data.sound]);
    } catch (err) {
      setUploadError(err.message || "Upload failed.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function removeCustom(id) {
    stopPreview();
    const res = await fetch(`/api/azan/upload?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      setCustomSounds((s) => s.filter((c) => c.id !== id));
      // Any prayer that pointed at this sound falls back to its default server-side;
      // refetch so the UI matches.
      const fresh = await fetch("/api/azan/settings").then((r) => (r.ok ? r.json() : null));
      if (fresh?.settings) {
        setSettings(fresh.settings);
        broadcast(fresh.settings);
      }
    }
  }

  // ---- Derived timetable -----------------------------------------------------
  const parsed = useMemo(() => {
    if (!timings) return null;
    return PRAYER_KEYS.map((key) => {
      const t = String(timings[key] || "00:00").slice(0, 5);
      const [h, m] = t.split(":").map(Number);
      return { key, label: PRAYER_LABELS[key], icon: PRAYER_ICONS[key], time: t, minutes: h * 60 + m };
    });
  }, [timings]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nextIndex = parsed ? parsed.findIndex((p) => p.minutes > nowMinutes) : -1;
  const next = parsed ? (nextIndex === -1 ? parsed[0] : parsed[nextIndex]) : null;
  const diff = next ? (((next.minutes - nowMinutes) % 1440) + 1440) % 1440 : 0;
  const countdown = diff >= 60 ? `${Math.floor(diff / 60)}h ${diff % 60}m` : `${diff}m`;

  const soundOptions = useMemo(() => {
    const bundled = BUNDLED_SOUNDS.map((s) => ({ value: s.id, label: s.label }));
    const custom = customSounds.map((s) => ({ value: `custom:${s.id}`, label: `⭐ ${s.label}` }));
    return [...bundled, ...custom];
  }, [customSounds]);

  if (!ready || !settings) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-card bg-paper-deep" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Next prayer hero */}
      <section className="rounded-card border-[0.5px] border-line bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold uppercase tracking-wider text-charcoal-soft">
              Prayer times{placeLabel ? ` · ${placeLabel}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Country for prayer times</span>
              <span className="text-charcoal-soft">
                <Icon name="globe" size={14} />
              </span>
              <select
                value={choice}
                onChange={(e) => pickCountry(e.target.value)}
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
            <button
              type="button"
              onClick={() => save({ muted: !settings.muted })}
              title={settings.muted ? "Azan is muted — tap to unmute" : "Azan is on — tap to mute all"}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                settings.muted ? "bg-paper-deep text-charcoal-soft" : "bg-gold text-white"
              }`}
            >
              <Icon name={settings.muted ? "bell-off" : "bell"} size={15} />
            </button>
          </div>
        </div>

        {timesError ? (
          <p className="text-[13px] text-rust">{timesError}</p>
        ) : !parsed ? (
          <div className="h-24 animate-pulse rounded-control bg-paper-deep" />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-center gap-2 rounded-control bg-gold px-4 py-3 text-[14px] font-semibold text-white shadow-[0_4px_12px_rgba(140,122,168,0.3)]">
              <span>Next prayer:</span>
              <span className="text-[17px] font-bold">{next.label}</span>
              <span>
                at {next.time} · in {countdown}
              </span>
            </div>
            {settings.muted && (
              <p className="mb-3 rounded-control bg-rust-soft px-3 py-2 text-center text-[12px] font-semibold text-rust">
                All azan sounds are muted. Tap the bell above to unmute.
              </p>
            )}
          </>
        )}

        {/* Per-prayer settings */}
        {parsed && (
          <ul className="divide-y divide-line">
            {parsed.map((p, i) => {
              const cfg = settings.prayers[p.key];
              const isNext = i === (nextIndex === -1 ? 0 : nextIndex);
              const previewValue = cfg.sound;
              return (
                <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <span
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${
                      isNext ? "bg-gold text-white" : PRAYER_TONES[p.key] || "bg-gold-soft text-ink"
                    }`}
                  >
                    <Icon name={p.icon} size={20} />
                  </span>
                  <div className="min-w-[72px]">
                    <div className="text-[14px] font-bold text-charcoal">{p.label}</div>
                    <div className="text-[12px] text-charcoal-soft">{p.time}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {cfg.enabled && (
                      <>
                        <select
                          value={cfg.sound}
                          onChange={(e) => setPrayer(p.key, { sound: e.target.value })}
                          aria-label={`Azan sound for ${p.label}`}
                          className="max-w-[170px] cursor-pointer rounded-control border-[0.5px] border-line bg-white px-2 py-1.5 text-[12px] font-semibold text-charcoal outline-none focus:border-ink"
                        >
                          {soundOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => togglePreview(previewValue)}
                          aria-label={previewId === previewValue ? "Stop preview" : `Preview azan for ${p.label}`}
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                            previewId === previewValue
                              ? "bg-gold text-white"
                              : "bg-gold-soft text-ink hover:bg-sand"
                          }`}
                        >
                          <Icon name={previewId === previewValue ? "pause" : "play"} size={14} />
                        </button>
                      </>
                    )}
                    <Toggle
                      checked={cfg.enabled}
                      onChange={(v) => setPrayer(p.key, { enabled: v })}
                      label={`Auto-play azan for ${p.label}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-2 text-center text-[11px] text-charcoal-soft">
          Source:{" "}
          <a
            href="https://aladhan.com/prayer-times-api"
            target="_blank"
            rel="noreferrer noopener"
            className="font-semibold text-charcoal underline decoration-line hover:text-ink"
          >
            Aladhan API
          </a>
          {authority ? ` · ${authority} calculation` : ""}
        </div>
      </section>

      {/* Notifications when the app is closed */}
      <section className="rounded-card border-[0.5px] border-line bg-white p-5">
        <h2 className="mb-1 text-[15px] font-bold text-charcoal">Notifications when the app is closed</h2>
        <p className="mb-4 text-[13px] leading-relaxed text-charcoal-soft">
          The azan sound plays while the portal is open. For prayer times that arrive when it isn&apos;t, enable
          notifications and this device will get a prayer-time alert — tap it to open the portal and hear the azan.
          {subscriptionCount > 0 && (
            <span className="mt-1 block font-semibold text-charcoal">
              {subscriptionCount} device{subscriptionCount === 1 ? "" : "s"} enabled on your account.
            </span>
          )}
        </p>
        {pushState === "unsupported" ? (
          <p className="rounded-control bg-paper-deep px-3 py-2 text-[12px] text-charcoal-soft">
            This browser doesn&apos;t support notifications. On iPhone/iPad, first add the portal to your Home Screen
            (Share → Add to Home Screen), then open it from there.
          </p>
        ) : (
          <button
            type="button"
            disabled={pushState === "busy"}
            onClick={pushState === "on" ? disablePush : enablePush}
            className={`inline-flex items-center gap-2 rounded-pill px-5 py-2.5 text-[13px] font-bold transition-colors disabled:opacity-60 ${
              pushState === "on"
                ? "border-[0.5px] border-line bg-white text-charcoal hover:bg-paper-deep"
                : "bg-gold text-white shadow-[0_4px_12px_rgba(140,122,168,0.35)] hover:bg-gold-hover"
            }`}
          >
            <Icon name={pushState === "on" ? "bell-off" : "bell"} size={15} />
            {pushState === "busy"
              ? "Working…"
              : pushState === "on"
                ? "Disable on this device"
                : "Enable on this device"}
          </button>
        )}
        {pushError && <p className="mt-2 text-[12px] text-rust">{pushError}</p>}
      </section>

      {/* Sound library */}
      <section className="rounded-card border-[0.5px] border-line bg-white p-5">
        <h2 className="mb-1 text-[15px] font-bold text-charcoal">Azan sounds</h2>
        <p className="mb-4 text-[13px] text-charcoal-soft">
          Listen to the built-in sounds, or upload your own recording (MP3/M4A/OGG/WAV, up to 8&nbsp;MB).
        </p>
        <ul className="divide-y divide-line">
          {BUNDLED_SOUNDS.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <button
                type="button"
                onClick={() => togglePreview(s.id)}
                aria-label={previewId === s.id ? "Stop preview" : `Play ${s.label}`}
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                  previewId === s.id ? "bg-gold text-white" : "bg-gold-soft text-ink hover:bg-sand"
                }`}
              >
                <Icon name={previewId === s.id ? "pause" : "play"} size={14} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-charcoal">{s.label}</div>
                <div className="text-[11px] text-charcoal-soft">
                  {Math.floor(s.duration / 60) ? `${Math.floor(s.duration / 60)}m ${s.duration % 60}s` : `${s.duration}s`}
                  {s.fajrOnly ? " · for Subuh" : ""}
                </div>
              </div>
            </li>
          ))}
          {customSounds.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <button
                type="button"
                onClick={() => togglePreview(`custom:${s.id}`)}
                aria-label={previewId === `custom:${s.id}` ? "Stop preview" : `Play ${s.label}`}
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                  previewId === `custom:${s.id}` ? "bg-gold text-white" : "bg-sage-soft text-sage hover:bg-sage-soft/70"
                }`}
              >
                <Icon name={previewId === `custom:${s.id}` ? "pause" : "play"} size={14} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-charcoal">{s.label}</div>
                <div className="text-[11px] text-charcoal-soft">Your upload</div>
              </div>
              <button
                type="button"
                onClick={() => removeCustom(s.id)}
                aria-label={`Delete ${s.label}`}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-charcoal-soft transition-colors hover:bg-rust-soft hover:text-rust"
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <input ref={fileRef} type="file" accept="audio/*" onChange={onUpload} className="hidden" />
          <button
            type="button"
            disabled={uploadBusy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-pill border-[0.5px] border-line bg-white px-5 py-2.5 text-[13px] font-bold text-charcoal transition-colors hover:bg-paper-deep disabled:opacity-60"
          >
            <Icon name="upload" size={15} />
            {uploadBusy ? "Uploading…" : "Upload a sound"}
          </button>
          {uploadError && <p className="mt-2 text-[12px] text-rust">{uploadError}</p>}
        </div>
        <p className="mt-4 border-t-[0.5px] border-line pt-3 text-[10.5px] leading-relaxed text-charcoal-soft">
          Built-in recordings: Masjid al-Haram adhans by Mohammed Tawsif Salam (CC BY 3.0); studio adhan by Aaqib
          Azeez (CC BY-SA 4.0); Fajr azan, Malmö Mosque (CC BY 3.0); classic recitation (CC BY-SA 4.0) — all via
          Wikimedia Commons.
        </p>
      </section>
    </div>
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

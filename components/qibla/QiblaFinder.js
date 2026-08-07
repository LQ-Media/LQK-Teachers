"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import PageHeading from "@/components/PageHeading";
import { COUNTRIES, BY_CODE, countryForTimezone } from "@/lib/countries";
import {
  qiblaBearing,
  distanceToKaabaKm,
  signedDelta,
  normalizeDeg,
  compassPoint,
  headingFromOrientation,
} from "@/lib/qibla";

const PLACE_KEY = "lqk_qibla_place";
const ALIGNED_DEG = 5; // within this many degrees counts as facing the Qibla

export default function QiblaFinder() {
  // Where we are: GPS if allowed, else a chosen country's reference city.
  const [coords, setCoords] = useState(null); // {lat,lng,label,precise}
  const [choice, setChoice] = useState("auto");
  const [locating, setLocating] = useState(true);

  // Compass
  const [heading, setHeading] = useState(null);
  const [compassState, setCompassState] = useState("idle"); // idle|need-permission|live|unavailable|denied
  const listeningRef = useRef(false);

  // --- location -------------------------------------------------------
  const useCountry = useCallback((code) => {
    const c = BY_CODE[code];
    if (!c) return;
    setCoords({ lat: c.lat, lng: c.lng, label: `${c.city}, ${c.name}`, precise: false });
    setLocating(false);
  }, []);

  useEffect(() => {
    let saved = null;
    try {
      saved = localStorage.getItem(PLACE_KEY);
    } catch {
      // ignore
    }
    if (saved && BY_CODE[saved]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChoice(saved);
      useCountry(saved);
      return;
    }

    const fallback = countryForTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      useCountry(fallback.code);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "Your location",
          precise: true,
        });
        setLocating(false);
      },
      () => useCountry(fallback.code), // denied/unavailable → country reference point
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    );
  }, [useCountry]);

  function pickPlace(value) {
    setChoice(value);
    try {
      localStorage.setItem(PLACE_KEY, value === "auto" ? "" : value);
    } catch {
      // ignore
    }
    if (value === "auto") {
      setLocating(true);
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Your location", precise: true });
          setLocating(false);
        },
        () => useCountry(countryForTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone).code),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
      );
    } else {
      useCountry(value);
    }
  }

  // --- compass --------------------------------------------------------
  const onOrientation = useCallback((event) => {
    const h = headingFromOrientation(event);
    if (h !== null) {
      setHeading(h);
      setCompassState("live");
    }
  }, []);

  const startCompass = useCallback(async () => {
    if (listeningRef.current) return;

    // iOS 13+ requires an explicit permission prompt from a user gesture.
    const DOE = typeof window !== "undefined" ? window.DeviceOrientationEvent : undefined;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        if (res !== "granted") {
          setCompassState("denied");
          return;
        }
      } catch {
        setCompassState("denied");
        return;
      }
    }

    listeningRef.current = true;
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);

    // If nothing reports an absolute heading shortly, treat as unavailable
    // (desktops and some tablets have no magnetometer).
    setTimeout(() => {
      setCompassState((s) => (s === "live" ? s : "unavailable"));
    }, 2500);
  }, [onOrientation]);

  useEffect(() => {
    const DOE = typeof window !== "undefined" ? window.DeviceOrientationEvent : undefined;
    if (!DOE) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompassState("unavailable");
      return;
    }
    if (typeof DOE.requestPermission === "function") {
      // iOS — wait for the user to tap "Enable compass".
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompassState("need-permission");
      return;
    }
    startCompass();
    return () => {
      listeningRef.current = false;
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
    };
  }, [startCompass, onOrientation]);

  // --- derived --------------------------------------------------------
  const qibla = coords ? qiblaBearing(coords.lat, coords.lng) : null;
  const distanceKm = coords ? distanceToKaabaKm(coords.lat, coords.lng) : null;
  const live = compassState === "live" && heading !== null;
  // With a live compass the rose counter-rotates so N points at true north;
  // otherwise we show a static north-up rose (bearing still correct).
  const roseRotation = live ? -heading : 0;
  const delta = live && qibla !== null ? signedDelta(heading, qibla) : null;
  const aligned = delta !== null && Math.abs(delta) <= ALIGNED_DEG;

  return (
    <div className="px-4 py-6 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <PageHeading
          route="/qibla"
          icon="compass"
          title="Qibla finder"
          subtitle="Lay your phone flat and turn until the Kaaba marker reaches the top."
        />
      </div>

      {/* Location */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-card border-[0.5px] border-line bg-white px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] text-charcoal">
          <span className="text-charcoal-soft">
            <Icon name="map-pin" size={15} />
          </span>
          {locating ? "Finding your location…" : coords?.label}
          {coords && !coords.precise && <span className="text-[11px] text-charcoal-soft">(approximate)</span>}
        </div>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Location for Qibla</span>
          <select
            value={choice}
            onChange={(e) => pickPlace(e.target.value)}
            className="max-w-[190px] cursor-pointer rounded-control border-[0.5px] border-line bg-white px-2 py-1 text-[12px] font-semibold text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
          >
            <option value="auto">Use my location</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Compass */}
      <div
        className={`rounded-card border-[0.5px] p-6 transition-colors ${
          aligned ? "border-gold bg-gold-soft/40" : "border-line bg-white"
        }`}
      >
        <div className="flex flex-col items-center">
          <Dial rotation={roseRotation} qibla={qibla ?? 0} live={live} aligned={aligned} />

          <div className="mt-5 text-center">
            {qibla !== null && (
              <>
                <div className="font-heading text-3xl font-bold tabular-nums text-charcoal">
                  {Math.round(qibla)}° <span className="text-[16px] font-semibold text-charcoal-soft">{compassPoint(qibla)}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-charcoal-soft">
                  Qibla from true north · {distanceKm?.toLocaleString("en-SG")} km to Makkah
                </div>
              </>
            )}

            {aligned && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-pill bg-gold px-3.5 py-1.5 text-[13px] font-bold text-white">
                <Icon name="check" size={15} /> Facing the Qibla
              </div>
            )}
            {live && !aligned && delta !== null && (
              <div className="mt-3 text-[13px] font-semibold text-charcoal">
                Turn {delta > 0 ? "right" : "left"} {Math.abs(Math.round(delta))}°
              </div>
            )}
          </div>

          <CompassStatus state={compassState} onEnable={startCompass} qibla={qibla} />
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-charcoal-soft">
        Direction is the great-circle bearing to the Kaaba (21.4225° N, 39.4832° E), calculated on your device. Phone
        compasses drift near metal, magnets and vehicles — if the needle looks wrong, move away and wave the phone in a
        figure-8 to recalibrate.
      </p>
    </div>
  );
}

// Compass rose. `rotation` spins the whole rose so N sits at true north;
// the Kaaba marker is drawn at the Qibla bearing on that rose, so it lands
// under the fixed pointer at the top when the user is facing the Qibla.
function Dial({ rotation, qibla, live, aligned }) {
  const size = 260;
  const c = size / 2;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Fixed pointer: the direction the phone is facing */}
      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1">
        <div
          className={`h-0 w-0 border-x-[7px] border-t-[11px] border-x-transparent ${
            aligned ? "border-t-gold" : "border-t-charcoal-soft"
          }`}
        />
      </div>

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transition-transform duration-200 ease-out"
        style={{ transform: `rotate(${rotation}deg)` }}
        aria-hidden="true"
      >
        <circle cx={c} cy={c} r={c - 6} fill="var(--color-paper)" stroke="var(--color-line)" strokeWidth="1" />
        <circle cx={c} cy={c} r={c - 30} fill="none" stroke="var(--color-line)" strokeWidth="1" />

        {/* Degree ticks every 15°, longer on the cardinals */}
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i * 15 * Math.PI) / 180;
          const cardinal = i % 6 === 0;
          const r1 = c - 8;
          const r2 = c - (cardinal ? 20 : 14);
          return (
            <line
              key={i}
              x1={c + r1 * Math.sin(a)}
              y1={c - r1 * Math.cos(a)}
              x2={c + r2 * Math.sin(a)}
              y2={c - r2 * Math.cos(a)}
              stroke={cardinal ? "var(--color-charcoal-soft)" : "var(--color-line)"}
              strokeWidth={cardinal ? 2 : 1}
              strokeLinecap="round"
            />
          );
        })}

        {/* Cardinal letters */}
        {[
          ["N", 0],
          ["E", 90],
          ["S", 180],
          ["W", 270],
        ].map(([label, deg]) => {
          const a = (deg * Math.PI) / 180;
          const r = c - 34;
          return (
            <text
              key={label}
              x={c + r * Math.sin(a)}
              y={c - r * Math.cos(a)}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="13"
              fontWeight="700"
              fill={label === "N" ? "var(--color-rust)" : "var(--color-charcoal-soft)"}
              transform={`rotate(${-rotation} ${c + r * Math.sin(a)} ${c - r * Math.cos(a)})`}
            >
              {label}
            </text>
          );
        })}

        {/* Qibla ray + Kaaba marker */}
        <g transform={`rotate(${qibla} ${c} ${c})`}>
          <line
            x1={c}
            y1={c}
            x2={c}
            y2={30}
            stroke="var(--color-gold)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={c} cy={30} r="15" fill="var(--color-gold)" />
          {/* Kaaba glyph */}
          <rect x={c - 6} y={24} width="12" height="12" rx="1.5" fill="#403548" />
          <rect x={c - 6} y={27} width="12" height="2.5" fill="var(--color-gold)" />
        </g>

        <circle cx={c} cy={c} r="5" fill="var(--color-ink)" />
      </svg>

      {!live && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] font-semibold uppercase tracking-wide text-charcoal-soft">
          North-up view
        </div>
      )}
    </div>
  );
}

function CompassStatus({ state, onEnable, qibla }) {
  if (state === "live") return null;

  if (state === "need-permission") {
    return (
      <button
        type="button"
        onClick={onEnable}
        className="mt-5 flex items-center gap-2 rounded-control bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep"
      >
        <Icon name="compass" size={16} /> Enable compass
      </button>
    );
  }

  const message =
    state === "denied"
      ? "Compass access was blocked. Allow motion & orientation access in your browser settings, or use the bearing above with a compass app."
      : "No compass on this device — the dial is shown north-up. Point yourself " +
        (qibla !== null ? `${Math.round(qibla)}° from true north` : "at the bearing above") +
        " using a compass app.";

  return (
    <p className="mt-5 max-w-sm text-center text-[12px] leading-relaxed text-charcoal-soft">{message}</p>
  );
}

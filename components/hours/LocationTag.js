"use client";

// The "where was this worked?" control for a work session. Ad-hoc / OT happens
// away from a fixed branch — a centre being cleaned, an event venue — so the
// teacher can stamp the session with one reading from their device.
//
// This component owns the device side (permission, the fix, naming it) and hands
// the result to whoever mounted it: the clock-in card and the add/edit modal keep
// it in form state until save, while the running-session card writes it straight
// away. See lib/hours/geo.js for the shape and lib/actions/hours.js for storage.

import { useState, useTransition } from "react";
import Icon from "@/components/Icon";
import { describeLocation } from "@/lib/actions/hours";
import { GEO_ATTRIBUTION, formatAccuracy, formatCoords, mapsUrl } from "@/lib/hours/geo";

// Browsers only hand out coordinates in a secure context. On a LAN address over
// plain http:// (a phone at the centre pointed at a laptop) the call silently
// never resolves, so say so instead of spinning — same trap as the notebook mic.
function insecure() {
  return typeof window !== "undefined" && !window.isSecureContext;
}

const GEO_ERRORS = {
  1: "Location permission is off for this site. Turn it on in your browser settings, then try again.",
  2: "Your device couldn’t get a location just now. Step outside or switch Wi-Fi on and try again.",
  3: "Getting a location took too long. Try again in a moment.",
};

/**
 * @param value    {lat,lng,accuracy,label} | null — the stamp as it stands
 * @param onChange (geo|null) => void | Promise<{error?}> — persist or stage it
 * @param compact  render as a single inline row (used on the running card)
 */
export default function LocationTag({ value, onChange, compact = false }) {
  const [error, setError] = useState(null);
  const [locating, setLocating] = useState(false);
  const [saving, startSaving] = useTransition();
  const busy = locating || saving;

  function commit(geo) {
    startSaving(async () => {
      const r = await onChange(geo);
      if (r?.error) setError(r.error);
    });
  }

  function capture() {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device can’t share a location.");
      return;
    }
    if (insecure()) {
      setError("Location needs a secure connection. Open the portal over https:// (or on localhost).");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        // Name it before showing it, so the teacher confirms a place rather than
        // a pair of numbers. A failed lookup still leaves a usable stamp.
        const named = await describeLocation(fix);
        setLocating(false);
        if (named?.error) {
          setError(named.error);
          return;
        }
        commit({ ...fix, label: named.label || null });
      },
      (err) => {
        setLocating(false);
        setError(GEO_ERRORS[err?.code] || "Couldn’t get your location. Try again.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  const btn =
    "flex items-center gap-1.5 rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[12px] font-semibold text-charcoal transition-colors hover:bg-paper-deep disabled:opacity-50";

  if (!value) {
    return (
      <div className={compact ? "" : "rounded-control border-[0.5px] border-dashed border-line bg-paper/60 p-3"}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={capture} disabled={busy} className={btn}>
            <Icon name="map-pin" size={14} />
            {locating ? "Finding you…" : saving ? "Saving…" : "Tag my location"}
          </button>
          {!compact && (
            <span className="text-[11px] text-charcoal-soft">
              Optional. Records one reading, now — not while you work.
            </span>
          )}
        </div>
        {error && <p className="mt-2 text-[11px] text-rust">{error}</p>}
      </div>
    );
  }

  return (
    <div className={compact ? "" : "rounded-control border-[0.5px] border-line bg-paper/60 p-3"}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-sage">
          <Icon name="map-pin" size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-charcoal break-words">
            {value.label || formatCoords(value.lat, value.lng)}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-charcoal-soft">
            {value.label && <span>{formatCoords(value.lat, value.lng)}</span>}
            {formatAccuracy(value.accuracy) && <span>{formatAccuracy(value.accuracy)}</span>}
            <a
              href={mapsUrl(value.lat, value.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-sage underline"
            >
              View map
            </a>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={capture} disabled={busy} title="Re-take" aria-label="Re-take location" className={btn}>
            <Icon name="refresh" size={13} />
            <span className="sr-only sm:not-sr-only">{locating ? "Finding…" : "Re-take"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              commit(null);
            }}
            disabled={busy}
            aria-label="Remove location"
            title="Remove location"
            className="flex h-8 w-8 items-center justify-center rounded-full border-[0.5px] border-line bg-white text-charcoal-soft transition-colors hover:bg-rust-soft hover:text-rust disabled:opacity-50"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-[11px] text-rust">{error}</p>}
      {!compact && <p className="mt-2 text-[10px] text-charcoal-soft">{GEO_ATTRIBUTION}</p>}
    </div>
  );
}

/** Read-only one-liner for a stamped session — used in lists, not forms. */
export function LocationLine({ geo, className = "" }) {
  if (!geo) return null;
  const acc = formatAccuracy(geo.accuracy);
  return (
    <a
      href={mapsUrl(geo.lat, geo.lng)}
      target="_blank"
      rel="noopener noreferrer"
      title={`${formatCoords(geo.lat, geo.lng)}${acc ? ` · ${acc}` : ""}`}
      className={`inline-flex max-w-full items-center gap-1 text-[11px] text-charcoal-soft hover:text-sage ${className}`}
    >
      <Icon name="map-pin" size={12} />
      <span className="truncate">{geo.label || formatCoords(geo.lat, geo.lng)}</span>
      {acc && <span className="shrink-0 text-charcoal-soft/80">{acc}</span>}
    </a>
  );
}
